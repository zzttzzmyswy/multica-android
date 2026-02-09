# Mobile Development Guide

Complete lifecycle guide for developing, testing, and publishing the Expo React Native app — from first line of code to App Store / Google Play.

## Overview

```
Phase 1: Environment Setup       You are here if starting fresh
    ↓
Phase 2: Development & Testing    Daily work loop
    ↓
Phase 3: Pre-Release Preparation  Before your first submission
    ↓
Phase 4: Build & Submit           Ship to stores
    ↓
Phase 5: Post-Launch              Maintain and update
```

---

## Phase 1: Environment Setup

### 1.1 Required Software

| Tool | Purpose | Install |
|------|---------|---------|
| **Node.js** (LTS) | JS runtime | `brew install node` or [nodejs.org](https://nodejs.org) |
| **pnpm** | Package manager | `corepack enable && corepack prepare pnpm@latest --activate` |
| **Xcode** | iOS build toolchain | Mac App Store (free) |
| **Xcode Command Line Tools** | Compilers, simulators | `xcode-select --install` |
| **CocoaPods** | iOS dependency manager | `sudo gem install cocoapods` |
| **Android Studio** | Android emulator + SDK (optional, iOS-first) | [developer.android.com](https://developer.android.com/studio) |
| **EAS CLI** | Expo build & submit | `npm install -g eas-cli` |
| **Expo CLI** | Dev server | Bundled with `npx expo` |

### 1.2 Xcode First-Time Setup

1. Open Xcode at least once to accept the license and install components
2. **Add your Apple ID** (free account is enough for development):
   - Xcode → Settings → Accounts → `+` → Apple ID
   - This creates a "Personal Team" for free code signing
3. Verify simulators are installed:
   - Xcode → Settings → Components → download an iOS Simulator runtime

### 1.3 iPhone First-Time Setup (for Real Device Testing)

1. **Enable Developer Mode** (required on iOS 16+):
   - Settings → Privacy & Security → Developer Mode → ON
   - Device will restart
2. Connect iPhone to Mac via USB/USB-C cable
3. When prompted "Trust This Computer?" → tap Trust

### 1.4 Project Setup

```bash
# Install dependencies
pnpm install

# Generate native project files (creates ios/ and android/ directories)
npx expo prebuild

# Initialize EAS configuration (creates eas.json)
eas build:configure
```

### 1.5 Expo Account

```bash
# Create account at expo.dev, then:
eas login
eas whoami  # verify
```

**No paid accounts needed at this stage.** Free Apple ID + free Expo account is enough for development.

---

## Phase 2: Development & Testing

### 2.1 Running on iOS Simulator

```bash
# Start the app in iOS simulator (no real device needed)
npx expo run:ios
```

- Fastest iteration loop — code changes hot-reload instantly
- Good for: UI layout, navigation, business logic, API calls
- **Cannot test**: camera, barcode scanner, real push notifications, biometrics

### 2.2 Running on Real iPhone

```bash
# Connect iPhone via USB, then:
npx expo run:ios --device
```

Expo CLI will:
1. Detect your connected device
2. Sign the app with your Personal Team (free Apple ID)
3. Build, install, and launch the app

**First time only**: After installation, go to:
- Settings → General → VPN & Device Management → Trust your developer certificate

#### Free Signing Limitations

| Limitation | Detail |
|-----------|--------|
| 7-day expiry | App stops launching after 7 days — just re-run `npx expo run:ios --device` |
| 3 devices max | Can register up to 3 test devices per Apple ID |
| Some entitlements unavailable | Push notifications, Apple Pay, iCloud require paid account |
| Cannot distribute to others | Only works on your own registered devices |

**Camera, barcode scanner, GPS, sensors all work fine with free signing.**

### 2.3 Daily Development Workflow

```
First time (or after native config changes):
  npx expo prebuild          Generate/update native projects
  npx expo run:ios --device  Build and install on device

Every day after that:
  npx expo start --dev-client  Start dev server only (no rebuild)
  → Open the app on device     It connects automatically
  → Edit code, save            Hot-reload updates instantly
```

**When do you need to rebuild?**

| Change | Rebuild needed? |
|--------|----------------|
| JS/TS code, React components | No — hot-reload |
| Styles, images, assets | No — hot-reload |
| Added new Expo SDK module | **Yes** — `npx expo prebuild && npx expo run:ios --device` |
| Changed `app.json` permissions | **Yes** — rebuild |
| Updated native dependency | **Yes** — rebuild |
| Upgraded Expo SDK version | **Yes** — rebuild |

### 2.4 Testing Native Features (Camera, Scanner)

| Feature | Simulator | Real Device |
|---------|-----------|-------------|
| Camera preview | Not available | Works |
| Barcode / QR scan | Not available | Works |
| GPS location | Simulated location via Xcode menu | Real GPS |
| Push notifications | Not available | Requires paid Apple Developer account |
| Haptic feedback | Not available | Works |
| Device sensors (accelerometer, gyroscope) | Not available | Works |

For camera/scanner features, **always test on a real device**.

### 2.5 Debugging Tools

#### Developer Menu

Press `m` in the terminal (or shake the device) to open:
- Toggle Performance Monitor
- Toggle Element Inspector
- Open React Native DevTools

#### React Native DevTools

The primary debugging tool (replaced Chrome DevTools since RN 0.76):

| Tab | Use |
|-----|-----|
| Console | View logs, execute JS in app context |
| Sources | Set breakpoints, step through code |
| Network | Inspect API requests (Expo only) |
| Components | Inspect React component tree and props |
| Profiler | Measure render performance |

#### VS Code Integration

Install the **Expo Tools** extension for:
- Breakpoint debugging directly in VS Code
- `app.json` / `app.config.ts` IntelliSense

#### Native Crash Debugging

For crashes in native modules (not JS):
- **iOS**: Open Xcode → Window → Devices and Simulators → View Device Logs
- **Android**: `adb logcat` in terminal

---

## Phase 3: Pre-Release Preparation

**This is when you need to start spending money.**

### 3.1 Accounts & Fees

| Platform | Cost | Registration Time | Required For |
|----------|------|-------------------|--------------|
| **Apple Developer Program** | $99/year | 1-2 days review | App Store distribution |
| **Google Play Console** | $25 one-time | Days to weeks review | Play Store distribution |
| **Expo Account** | Free tier sufficient | Instant | EAS Build & Submit |

Register early — account review takes time, especially Google.

### 3.2 App Configuration

Update `app.json` or `app.config.ts`:

```jsonc
{
  "name": "Multica",
  "slug": "multica",
  "version": "1.0.0",
  "ios": {
    "bundleIdentifier": "com.multica.app",
    "buildNumber": "1",                    // increment each submission
    "infoPlist": {
      "NSCameraUsageDescription": "Used to scan QR codes and take photos",
      "NSPhotoLibraryUsageDescription": "Used to save scanned images"
    }
  },
  "android": {
    "package": "com.multica.app",
    "versionCode": 1,                      // increment each submission
    "permissions": ["CAMERA"]
  },
  "icon": "./assets/icon.png",            // 1024x1024 PNG, no transparency
  "splash": {
    "image": "./assets/splash.png"
  }
}
```

### 3.3 EAS Build Profiles

`eas.json`:

```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  },
  "submit": {
    "production": {}
  }
}
```

### 3.4 App Signing & Credentials

#### iOS

EAS auto-manages credentials (recommended):
- Distribution Certificate
- Provisioning Profile
- Or create manually in [Apple Developer Portal](https://developer.apple.com)

#### Android

- EAS auto-generates Keystore, stored securely on EAS servers
- **Back up your Keystore** — losing it means you can never update the published app
- Play Store requires AAB (Android App Bundle) format

### 3.5 Required Assets

| Asset | Spec |
|-------|------|
| **App Icon** | 1024x1024 PNG, no alpha/transparency (iOS) |
| **Splash Screen** | Platform-appropriate sizes |
| **iOS Screenshots** | 6.7", 6.5", 5.5" iPhone sizes + iPad (if universal) |
| **Android Screenshots** | 2-8 screenshots |

### 3.6 Required Metadata

#### Both Platforms

| Item | Notes |
|------|-------|
| **Privacy Policy URL** | Publicly accessible. Must disclose data collection, third-party sharing, AI usage, deletion rights |
| **App Description** | Short (≤80 chars for Google) + full description |
| **Support URL** | Where users can get help |
| **Account Deletion** | If app has registration, must support in-app account + data deletion |

#### Apple App Store Connect

| Item | Details |
|------|---------|
| Privacy Nutrition Labels | Data collection practices per category |
| App Review Information | Reviewer contact info, demo/test account |
| Content Rating | Age classification |
| Export Compliance | Encryption usage declaration |
| Info.plist Permission Strings | Clear purpose description for each permission |

#### Google Play Console

| Item | Details |
|------|---------|
| Data Safety Form | Required even if no data is collected |
| Content Rating Questionnaire | IARC rating |
| Target Audience | Must declare if targeting children |
| First Upload | Must upload AAB manually (Google API limitation) |

---

## Phase 4: Build & Submit

### 4.1 Production Build

```bash
# iOS
eas build --platform ios --profile production

# Android
eas build --platform android --profile production

# Both platforms
eas build --platform all --profile production
```

Builds run in Expo cloud — no local Xcode or Android Studio needed for production builds.

### 4.2 Submit to Apple App Store

```bash
eas submit --platform ios
```

This uploads the build to **App Store Connect / TestFlight**. Then:

1. Log into [App Store Connect](https://appstoreconnect.apple.com)
2. Select the uploaded build
3. Associate it with a version
4. Fill in all metadata, screenshots, privacy nutrition labels
5. Submit for App Review

### 4.3 Submit to Google Play Store

```bash
eas submit --platform android
```

**First time**: Must upload AAB manually in [Play Console](https://play.google.com/console).

After initial upload:
1. Navigate to Production → Create new release
2. Upload AAB or use the EAS-submitted build
3. Fill in description, screenshots, data safety form
4. Submit for review

### 4.4 Auto-Submit (Optional)

Build and submit in one step:

```bash
eas build --platform all --profile production --auto-submit
```

### 4.5 App Review

| | Apple | Google |
|---|---|---|
| Review time | Typically 24-48 hours | Hours to 7 days |
| Common rejections | Incomplete features, misleading screenshots, missing privacy policy, unclear permission strings | Data safety form mismatch, policy violations |
| After rejection | Fix issues, resubmit | Fix issues, resubmit |

---

## Phase 5: Post-Launch

### 5.1 OTA Updates (No Re-Review)

For JS/asset-only changes, push updates without going through App Review:

```bash
eas update --branch production
```

- Instant delivery to users — no store review
- Only works for JavaScript and asset changes
- **Native code changes still require a new build + review**

### 5.2 Version Bumping

For each new store submission:
- iOS: increment `buildNumber` in `app.json`
- Android: increment `versionCode` in `app.json`
- Bump `version` for user-visible version changes

### 5.3 CI/CD Automation

Create `.eas/workflows/build-and-submit.yml` to auto-build and submit on push to main.

#### Google Service Account Key (Automated Android Submissions)

1. EAS dashboard → Credentials → Android
2. Click Application identifier → Service Credentials
3. Add Google Service Account Key

---

## Quick Reference

### Common Commands

```bash
# Development
npx expo prebuild                   # Generate native projects
npx expo run:ios                    # Run on iOS simulator
npx expo run:ios --device           # Run on connected iPhone
npx expo start --dev-client         # Start dev server (after initial install)

# Building
eas build --platform ios --profile development   # Dev build (for device testing)
eas build --platform ios --profile production     # Production build
eas build --platform all --profile production     # Both platforms

# Submitting
eas submit --platform ios           # Submit to App Store
eas submit --platform android       # Submit to Play Store

# OTA Updates
eas update --branch production      # Push JS update to users
```

### Cost Summary

| Phase | Cost |
|-------|------|
| Development + local testing | **Free** (free Apple ID + Xcode) |
| EAS cloud builds | Free tier: 30 iOS + 30 Android builds/month |
| App Store submission | **$99/year** (Apple Developer Program) |
| Play Store submission | **$25 one-time** (Google Play Console) |

---

## Master Checklist

### Development Phase
- [ ] Install Node.js, pnpm, Xcode, EAS CLI
- [ ] Add Apple ID to Xcode (Settings → Accounts)
- [ ] Enable Developer Mode on iPhone
- [ ] Run `npx expo prebuild`
- [ ] Test on simulator: `npx expo run:ios`
- [ ] Test on real device: `npx expo run:ios --device`
- [ ] Trust developer certificate on device
- [ ] Verify camera/scanner functionality on real device

### Pre-Release Phase
- [ ] Register Apple Developer Program ($99/year)
- [ ] Register Google Play Console ($25)
- [ ] Configure `app.json` (bundleIdentifier, permissions, icon, splash)
- [ ] Configure `eas.json` build profiles
- [ ] Prepare app icon (1024x1024 PNG)
- [ ] Prepare splash screen
- [ ] Take App Store screenshots (all required sizes)
- [ ] Write and host privacy policy URL
- [ ] Write app description (short + full)
- [ ] Set up support URL
- [ ] Implement in-app account deletion (if registration exists)

### Submission Phase
- [ ] Run `eas build --platform all --profile production`
- [ ] iOS: `eas submit --platform ios`
- [ ] iOS: Fill metadata + privacy labels in App Store Connect
- [ ] iOS: Submit for App Review
- [ ] Android: Upload first AAB manually in Play Console
- [ ] Android: `eas submit --platform android`
- [ ] Android: Fill data safety form + metadata in Play Console
- [ ] Android: Submit for review
- [ ] Wait for review approval → app goes live

### Post-Launch Phase
- [ ] Set up `eas update` for OTA updates
- [ ] Set up CI/CD workflow (optional)
- [ ] Configure Google Service Account Key for automated Android submissions (optional)

---

## References

- [Expo: Getting Started](https://docs.expo.dev/get-started/introduction/)
- [Expo: Development Builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo: Local App Development](https://docs.expo.dev/guides/local-app-development/)
- [Expo: Debugging Tools](https://docs.expo.dev/debugging/tools/)
- [Expo: Submit to App Stores](https://docs.expo.dev/deploy/submit-to-app-stores/)
- [Expo: EAS Submit](https://docs.expo.dev/submit/introduction/)
- [Expo: EAS Update](https://docs.expo.dev/eas-update/introduction/)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple App Privacy Details](https://developer.apple.com/app-store/app-privacy-details/)
- [Google Play Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Google Play Developer Policy Center](https://play.google/developer-content-policy/)
