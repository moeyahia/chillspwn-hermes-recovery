#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

sdk_has_platform() {
  [ -d "$1/platforms" ] && [ -d "$1/build-tools" ]
}

if [ -n "${ANDROID_HOME:-}" ] && sdk_has_platform "$ANDROID_HOME"; then
  SDK_ROOT="$ANDROID_HOME"
elif [ -n "${ANDROID_SDK_ROOT:-}" ] && sdk_has_platform "$ANDROID_SDK_ROOT"; then
  SDK_ROOT="$ANDROID_SDK_ROOT"
else
  SDK_ROOT=""
  for candidate in \
    "$HOME/Android/Sdk" \
    "$HOME/android-sdk" \
    "/opt/android-sdk" \
    "/usr/lib/android-sdk"; do
    if sdk_has_platform "$candidate"; then
      SDK_ROOT="$candidate"
      break
    fi
  done
fi

if [ -z "$SDK_ROOT" ]; then
  echo "Android SDK not found. Set ANDROID_HOME or ANDROID_SDK_ROOT to a complete SDK." >&2
  exit 2
fi

export ANDROID_HOME="$SDK_ROOT"
export ANDROID_SDK_ROOT="$SDK_ROOT"

cd "$PROJECT_ROOT/android"
./gradlew assembleDebug
