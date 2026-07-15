import { type ReactNode, useEffect, useState } from "react";
import { useEventStream } from "../../data/events/EventStreamProvider";
import { Icon } from "../../design-system/components/Icon";
import { AppLink, useNavigation } from "../router/navigation";
import { isNavigationItemActive, PRIMARY_NAVIGATION } from "../router/routes";
import { CommandPalette } from "../command-palette/CommandPalette";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useNavigation();
  const stream = useEventStream();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const streamLabel = stream.state === "connected"
    ? "Live updates connected"
    : stream.state === "fallback"
      ? "Live stream degraded; authoritative views refresh every 30 seconds"
      : stream.state === "reconnecting"
        ? "Reconnecting live updates"
        : stream.state === "offline"
          ? "Offline; showing last validated state"
          : "Connecting live updates";

  useEffect(() => {
    setNavigationOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setNavigationOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="command-os">
      <a className="os-skip-link" href="#command-os-content">Skip to content</a>
      <header className="os-topbar">
        <button className="os-icon-button os-menu-button" type="button" aria-label="Open navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <AppLink href="/" className="os-brand" aria-label="ChillsPwn Command OS home">
          <img src="/Logo.svg" alt="" />
          <span><strong>COMMAND OS</strong><small>ChillsPwn · V2.1</small></span>
        </AppLink>
        <button type="button" className="os-command-trigger" aria-label="Search or run a command" onClick={() => setPaletteOpen(true)}>
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>
          <span>Search or run a command</span>
          <kbd>{navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"} K</kbd>
        </button>
        <div className="os-topbar-actions">
          <NotificationCenter />
          <div
            className={`os-stream os-stream--${stream.state}`}
            title={`${streamLabel}${stream.lastEvent?.summary ? ` · ${stream.lastEvent.summary}` : ""}`}
          >
            <span aria-hidden="true" />
            <span>{stream.state === "connected" ? "Live" : stream.state === "fallback" ? "Fallback refresh" : stream.state}</span>
          </div>
        </div>
        <p className="os-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{streamLabel}</p>
      </header>

      <div className="os-frame">
        {navigationOpen && <button className="os-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} />}
        <aside className={`os-sidebar ${navigationOpen ? "is-open" : ""}`} aria-label="Primary navigation">
          <div className="os-sidebar-heading">
            <span>Operations</span>
            <button type="button" className="os-icon-button" aria-label="Close navigation" onClick={() => setNavigationOpen(false)}>
              <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <nav>
            {PRIMARY_NAVIGATION.map((item) => {
              const active = isNavigationItemActive(item, pathname);
              return (
                <AppLink key={item.path} href={item.path} className={`os-nav-item ${active ? "is-active" : ""}`} aria-label={item.label}>
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                </AppLink>
              );
            })}
          </nav>
          <div className="os-sidebar-footer">
            <p>Authorized operations only</p>
          </div>
        </aside>

        <main id="command-os-content" className="os-content" tabIndex={-1}>{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
