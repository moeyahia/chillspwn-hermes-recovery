# Platform support and packaging

## Supported application boundary

The canonical deployment is the authenticated web application served by the
ChillsPwn Bun/Express process. The React application remains packaged through
Capacitor for Android. The Android shell uses application ID
`com.chillspwn.app`, reads the production bundle from `dist`, and does not set a
remote server URL in normal packaged builds.

`CAPACITOR_SERVER_URL` is an explicit development-only live-reload override.
It must point to a trusted host. `CAPACITOR_ALLOW_MIXED_CONTENT` remains false
unless a developer deliberately opts in; it must not be enabled for a release.

## Reproducible validation

From `chillspwn/plugin/webapp`:

```bash
bun install --frozen-lockfile
bun run mobile:doctor:android
bun run mobile:build:android
```

`mobile:build:android` builds the production web bundle, synchronizes it into
the Android project, and invokes the repository Gradle wrapper's
`assembleDebug` task. It honors `ANDROID_HOME`/`ANDROID_SDK_ROOT` and otherwise
checks the conventional per-user and system SDK locations without creating a
machine-specific `local.properties`. Copied web assets, Gradle caches,
APKs, bundles, signing keys, and `google-services.json` remain ignored.

The Capacitor doctor can report a missing `app/src/main/assets` directory before
the first sync. That is expected because generated web assets are not committed;
the release gate is the doctor result after `mobile:sync:android`, followed by a
successful Gradle build.

## Current limitations

- iOS is not configured in this recovery repository.
- Device-level notification delivery is not part of the current Command OS V2
  contract.
- Mobile acceptance uses browser viewports until a physical Android-device run
  is recorded. A debug APK build proves packaging, not device usability.
- Release signing is intentionally operator-managed and must never use a key
  stored in this repository.
