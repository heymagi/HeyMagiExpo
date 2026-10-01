# Upgrading SDK 54 -> 57

Why: Expo Go on iOS only ever supports the newest SDK. As of SDK 57 (released 30 June
2026) there is no way to install an older Expo Go on a physical iPhone, so a project on 54
cannot be opened on one at all. Staying put means never testing on device.

## What actually breaks for THIS project

Checked against the tree rather than assumed. Nothing in `app/`, `components/`, `contexts/`,
`lib/` or `theme/` imports `@react-navigation/*`, `@expo/vector-icons`, `expo-av` or
`expo-file-system`, which is where most of the 55/56 breakage lives. What remains:

| Change | Where | Status |
|---|---|---|
| `newArchEnabled` removed from app config (SDK 55) | `app.json` | done |
| `expo-blur`: `experimentalBlurMethod` -> `blurMethod` (SDK 55) | `components/ui/Glass.tsx` | to do during the glass rebuild |
| `expo/fetch` becomes `globalThis.fetch` (SDK 56) | the streaming client | simplifies it -- no import needed |
| `expo-router` no longer depends on react-navigation (SDK 56) | — | not affected; nothing imports it |
| Minimum iOS 16.4 | — | fine |

Also dropped five unused dependencies inherited from the original Bolt scaffold, so they
cannot drag the upgrade sideways: `expo-camera`, `expo-symbols`, `react-native-webview`,
`@react-navigation/bottom-tabs`, `@lucide/lab`. `expo-blur` deliberately stays — the glass
surfaces are built on it.

## Steps

```
npm install expo@^57.0.0
npx expo install --fix
npx expo-doctor
npx expo start --clear
```

`expo install --fix` is what realigns every Expo-managed package to the versions SDK 57
expects, including reanimated (4.5) and worklets (0.10). Do not skip it: a reanimated/
worklets mismatch is exactly what broke `expo start` the first time this project was set up.

## Known regression to ignore

SDK 56 shipped increased memory usage with Hermes v1 and `react-native-worklets`, affecting
anything importing reanimated. SDK 57 fixes it, which is another reason to go to 57 rather
than stopping at 56.
