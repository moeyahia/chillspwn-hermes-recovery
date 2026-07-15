#!/usr/bin/env python3
"""
Server resource threshold alert for Hermes cron.

Purpose:
- Check CPU and RAM consumption on the Kali server.
- Print a Telegram-deliverable WARNING alert when CPU or RAM is >= 70%.
- Print a Telegram-deliverable CRITICAL alert when CPU or RAM is >= 95%.
- Stay silent when usage is below the warning threshold so cron does not spam the user.
- Use a cooldown/state file so sustained high usage sends periodic alerts, not every minute.
"""

import json
import os
import sys
import time
from pathlib import Path

# Warning threshold requested by the operator.
WARNING_PERCENT = 70.0

# Critical threshold requested by the operator.
CRITICAL_PERCENT = 95.0

# Minimum time between repeated alerts while the same severity remains active.
# This prevents Telegram spam if CPU/RAM stays above a threshold for a while.
COOLDOWN_SECONDS = 15 * 60

def configured_state_path() -> Path:
    """Return the explicitly configured private state path."""
    raw_path = os.environ.get("HERMES_RESOURCE_ALERT_STATE_PATH", "").strip()
    if not raw_path:
        raise RuntimeError("HERMES_RESOURCE_ALERT_STATE_PATH is required")

    state_path = Path(raw_path).expanduser()
    if not state_path.is_absolute():
        raise RuntimeError("HERMES_RESOURCE_ALERT_STATE_PATH must be absolute")
    return state_path


def configured_host_label() -> str:
    """Return a non-sensitive operator-provided label for alert routing."""
    host_label = os.environ.get("HERMES_RESOURCE_ALERT_HOST_LABEL", "").strip()
    if not host_label:
        raise RuntimeError("HERMES_RESOURCE_ALERT_HOST_LABEL is required")
    if "\n" in host_label or "\r" in host_label:
        raise RuntimeError("HERMES_RESOURCE_ALERT_HOST_LABEL must be one line")
    return host_label


def read_cpu_percent(interval: float = 1.0) -> float:
    """Calculate CPU usage percentage from /proc/stat over a short interval."""

    def sample_cpu_times() -> tuple[int, int]:
        """Return total and idle CPU jiffies from the aggregate cpu line."""
        with open("/proc/stat", "r", encoding="utf-8") as handle:
            fields = handle.readline().split()

        # /proc/stat aggregate format:
        # cpu user nice system idle iowait irq softirq steal guest guest_nice
        values = [int(value) for value in fields[1:]]

        # Idle time includes idle + iowait.
        idle = values[3] + values[4]

        # Total time is the sum of all CPU states.
        total = sum(values)
        return total, idle

    total_1, idle_1 = sample_cpu_times()
    time.sleep(interval)
    total_2, idle_2 = sample_cpu_times()

    total_delta = total_2 - total_1
    idle_delta = idle_2 - idle_1

    # Avoid division by zero on impossible/very unusual procfs reads.
    if total_delta <= 0:
        return 0.0

    busy_delta = total_delta - idle_delta
    return max(0.0, min(100.0, (busy_delta / total_delta) * 100.0))


def read_ram_percent() -> float:
    """Calculate RAM usage percentage from /proc/meminfo using MemAvailable."""
    meminfo: dict[str, int] = {}

    with open("/proc/meminfo", "r", encoding="utf-8") as handle:
        for line in handle:
            key, value = line.split(":", 1)
            # Values are in kB; keep them as integers because only ratios matter.
            meminfo[key] = int(value.strip().split()[0])

    total = meminfo.get("MemTotal", 0)
    available = meminfo.get("MemAvailable", 0)

    if total <= 0:
        return 0.0

    used = total - available
    return max(0.0, min(100.0, (used / total) * 100.0))


def determine_severity(cpu_percent: float, ram_percent: float) -> tuple[str | None, float, str]:
    """Return alert severity, threshold value, and emoji for current resource usage."""
    highest_percent = max(cpu_percent, ram_percent)

    # Critical takes priority over warning when either metric crosses 95%.
    if highest_percent >= CRITICAL_PERCENT:
        return "CRITICAL", CRITICAL_PERCENT, "🚨"

    # Warning fires when either metric crosses 70% but neither crosses 95%.
    if highest_percent >= WARNING_PERCENT:
        return "WARNING", WARNING_PERCENT, "⚠️"

    # No alert needed below warning threshold.
    return None, 0.0, ""


def triggered_metrics(cpu_percent: float, ram_percent: float, threshold: float) -> list[str]:
    """List the resources that crossed the active threshold."""
    triggered = []

    if cpu_percent >= threshold:
        triggered.append(f"CPU {cpu_percent:.1f}%")

    if ram_percent >= threshold:
        triggered.append(f"RAM {ram_percent:.1f}%")

    return triggered


def load_state(state_path: Path) -> dict:
    """Load the previous alert timestamp/state if it exists."""
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state_path: Path, state: dict) -> None:
    """Persist alert state for cooldown tracking."""
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    state_path.chmod(0o600)


def should_alert(now: int, state: dict, severity: str) -> bool:
    """Decide whether to alert now based on severity changes and cooldown."""
    previous_severity = state.get("severity")
    last_alert = int(state.get("last_alert", 0))

    # Always alert immediately when escalating, for example WARNING -> CRITICAL.
    if previous_severity != severity:
        return True

    # Repeat same-severity alerts only after the cooldown.
    return now - last_alert >= COOLDOWN_SECONDS


def main() -> None:
    """Check resources and print an alert only if threshold/cooldown conditions match."""
    try:
        state_path = configured_state_path()
        host_label = configured_host_label()
    except RuntimeError as error:
        print(f"server-resource-alert: {error}", file=sys.stderr)
        raise SystemExit(2) from error

    cpu_percent = read_cpu_percent()
    ram_percent = read_ram_percent()
    severity, threshold, emoji = determine_severity(cpu_percent, ram_percent)

    state = load_state(state_path)
    now = int(time.time())

    # If usage is below 70%, mark the monitor inactive and stay silent.
    if severity is None:
        if state.get("active"):
            save_state(state_path, {"active": False, "severity": None, "last_alert": int(state.get("last_alert", 0))})
        return

    # If this is the same severity and still inside cooldown, stay silent.
    if not should_alert(now, state, severity):
        save_state(state_path, {"active": True, "severity": severity, "last_alert": int(state.get("last_alert", 0))})
        return

    save_state(state_path, {"active": True, "severity": severity, "last_alert": now})
    trigger_text = ", ".join(triggered_metrics(cpu_percent, ram_percent, threshold))

    # Cron no_agent delivers stdout verbatim to Telegram.
    print(
        f"{emoji} Server Resource {severity}\n\n"
        f"Host: {host_label}\n"
        f"Severity: {severity}\n"
        f"Threshold: {threshold:.0f}%\n"
        f"Triggered: {trigger_text}\n\n"
        f"Current CPU: {cpu_percent:.1f}%\n"
        f"Current RAM: {ram_percent:.1f}%\n\n"
        "Alert policy: warning at 70%, critical at 95%. "
        "I stay silent below 70% and throttle repeated same-severity alerts for 15 minutes."
    )


if __name__ == "__main__":
    main()
