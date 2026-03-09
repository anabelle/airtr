# Push Notifications

This repo now includes a shared push-notification foundation for:

- browser / PWA via the standards-based Push API + service worker + VAPID
- compiled Android via Capacitor + FCM

## Architecture summary

Gameplay authority is **not** centralized.

- Airline state, timeline events, and progression still come from the client + Nostr reduction.
- The backend layer only stores delivery metadata: web push subscriptions, Android FCM tokens, registration timestamps, and notification preferences.
- Notification candidates are derived from existing timeline events in the web app (`apps/web/src/features/notifications`).
- Missed pushes always remain visible through the in-app timeline / toast surfaces.

### Important delivery note

The repo now has the delivery pipeline, registration flow, and event classification/fan-out path. Today the web client forwards newly observed timeline events to `/api/notifications/send`, which lets one active device fan out pushes to the user’s other registered devices.

For fully unattended production delivery, you can also call the same `/api/notifications/send` pipeline from a relay observer, scheduled worker, or other Nostr-aware process that watches airline events. That keeps push delivery infrastructure separate from gameplay authority.

## Files added or updated

### Web app

- `apps/web/public/manifest.webmanifest`
- `apps/web/public/notification-sw.js`
- `apps/web/public/icons/*`
- `apps/web/src/features/notifications/*`
- `apps/web/src/app/main.tsx`
- `apps/web/src/routes/-corporate.lazy.tsx`
- `apps/web/src/shared/components/layout/Topbar.tsx`

### Android / Capacitor

- `apps/web/android/app/src/main/AndroidManifest.xml`
- `apps/web/android/app/src/main/java/com/airtr/app/MainActivity.java`
- `apps/web/android/app/src/main/res/values/colors.xml`
- `apps/web/android/app/capacitor.build.gradle`
- `apps/web/android/capacitor.settings.gradle`

### Cloudflare Pages Functions

- `functions/api/notifications/[[path]].ts`

## Required configuration

### 1. Browser push (VAPID)

You need a VAPID keypair.

Required values:

- `VITE_WEB_PUSH_PUBLIC_KEY` — exposed to the web app for `PushManager.subscribe`
- `WEB_PUSH_VAPID_PUBLIC_KEY` — server-side copy for Pages Functions
- `WEB_PUSH_VAPID_PRIVATE_KEY` — server-side private key for Pages Functions
- `PUSH_CONTACT_EMAIL` — optional mailto identity for VAPID headers; defaults to `support@acars.pub`

The web app reads `VITE_WEB_PUSH_PUBLIC_KEY` when the user explicitly enables browser push.

### 2. Cloudflare delivery storage

Create a D1 database and bind it to Pages Functions as:

- `NOTIFICATIONS_DB`

The Pages Function auto-creates the required tables on first use:

- `notification_registrations`
- `notification_deliveries`

These tables store **delivery metadata only**.

### 3. Firebase / Android push

You need a Firebase project with Cloud Messaging enabled.

Required server-side secrets / bindings:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

These are used for FCM HTTP v1 OAuth/JWT token exchange inside the Pages Function.

### 4. Native Android app file

Place your Firebase config file at:

- `apps/web/android/app/google-services.json`

The Android Gradle project already conditionally applies Google services when that file exists.

### 5. Android App Links verification

The Android manifest now includes `autoVerify="true"` App Links for:

- `https://acars.pub`
- `https://www.acars.pub`

For Android App Links verification to succeed in production, each host must serve:

- `/.well-known/assetlinks.json`

That file must include:

- package name: `com.airtr.app`
- your release signing certificate SHA-256 fingerprint

Because the signing fingerprint is environment-specific, this repo does not hard-code the final
`assetlinks.json` contents for you.

## Local development

### Install and validate

```bash
corepack pnpm install
corepack pnpm --filter @acars/core build
corepack pnpm --filter @acars/data build
corepack pnpm --filter @acars/nostr build
corepack pnpm --filter @acars/store build
corepack pnpm --filter @acars/web test
corepack pnpm --filter @acars/web typecheck
corepack pnpm --filter @acars/web lint
```

### Run the web app

```bash
corepack pnpm --filter @acars/web dev
```

### Sync Android after dependency/config changes

```bash
corepack pnpm --filter @acars/web exec cap sync android
```

## How to test browser push

1. Provide the VAPID public key via `VITE_WEB_PUSH_PUBLIC_KEY`.
2. Start the web app.
3. Open Corporate → Notifications.
4. Accept the soft ask and then the browser permission prompt.
5. Confirm the settings card shows the device as registered.
6. Use **Send test notification**.
7. Confirm the service worker displays the notification and clicking it deep-links back into ACARS.

## How to test Android push

1. Add `google-services.json` to `apps/web/android/app/`.
2. Configure the Firebase service-account secrets for the Pages Function.
3. Run `corepack pnpm --filter @acars/web exec cap sync android`.
4. Build/install the Android app.
5. Open Corporate → Notifications in the Capacitor app.
6. Accept the Android 13+ notification permission prompt when requested.
7. Confirm the settings card reports Android push ready.
8. Use **Send test notification** and verify foreground receive / tap deep-link behavior.

## Delivery endpoints

Pages Functions route:

- `POST /api/notifications/register`
- `POST /api/notifications/unregister`
- `POST /api/notifications/send`

The client stores an opaque registration secret locally and uses that secret when forwarding timeline-derived notification candidates, so one registered device can trigger delivery to the same pubkey’s other registered devices without introducing gameplay authority on the backend.

## Default signal rules

Enabled by default:

- `bankruptcy`
- `financial_warning`
- `competitor_hub`
- `price_war`
- `delivery`
- `tier_upgrade`
- `purchase`
- `sale`

Disabled by default:

- `takeoff`
- `landing`
- `maintenance`
- `ferry`

Quiet hours suppress non-critical notifications only; critical finance alerts still break through.

## Android caveat

Android 13+ requires runtime notification permission, so the app only requests it after explicit user intent from the settings UI. Android 15 Private Space can still delay or hide notifications while the app is locked inside that private environment; that is platform behavior rather than app-specific logic.
