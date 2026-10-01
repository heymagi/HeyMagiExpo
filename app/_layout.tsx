/**
 * Root layout.
 *
 * Providers wrap in dependency order: the theme has no dependencies and must be available
 * before anything renders (otherwise the first paint is the wrong colours); auth supplies the
 * gate; the MAGI session depends on auth.
 *
 * Routing is a guard, not a navigator the user drives. There is one screen. Everything else
 * here is a gate that has to be passed once — age assurance, guardian consent for under-16s,
 * and a short setup — and then never seen again.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';

import { ThemeProvider, useTheme, usePreferences } from '@/theme';
import { AuthProvider, useAuth, type Gate } from '@/contexts/AuthContext';
import { MagiProvider } from '@/contexts/MagiContext';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <MagiProvider>
            <Shell />
          </MagiProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** Where each gate sends the user. */
const ROUTE_FOR_GATE: Record<Exclude<Gate, 'loading' | 'ready'>, string> = {
  signed_out: '/welcome',
  age_check: '/age-check',
  guardian: '/guardian',
  onboarding: '/setup',
};

function Shell() {
  const t = useTheme();
  const { ready: prefsReady } = usePreferences();
  const { gate } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  const [fontsLoaded, fontError] = useFonts({
    // Atkinson Hyperlegible, bundled rather than fetched: a user who has chosen it because
    // they cannot otherwise read the screen must not lose it when they are offline.
    AtkinsonHyperlegible: require('../assets/fonts/AtkinsonHyperlegible-Regular.ttf'),
    AtkinsonHyperlegibleBold: require('../assets/fonts/AtkinsonHyperlegible-Bold.ttf'),
  });

  const bootReady = prefsReady && (fontsLoaded || Boolean(fontError)) && gate !== 'loading';

  useEffect(() => {
    if (bootReady) SplashScreen.hideAsync().catch(() => undefined);
  }, [bootReady]);

  useEffect(() => {
    if (!bootReady) return;
    const current = segments[0] ?? '';
    // The design preview is reachable in development without signing in; it talks to nothing.
    if (__DEV__ && current === 'preview') return;
    if (gate === 'ready') {
      // Any gate screen still on top means a gate was just satisfied.
      if (['welcome', 'sign-in', 'sign-up', 'age-check', 'guardian', 'setup'].includes(current)) {
        router.replace('/');
      }
      return;
    }
    const target = ROUTE_FOR_GATE[gate];
    // Sign-in and sign-up are both valid places to be while signed out.
    if (gate === 'signed_out' && ['welcome', 'sign-in', 'sign-up'].includes(current)) return;
    if (target && `/${current}` !== target) router.replace(target);
  }, [bootReady, gate, segments, router]);

  if (!bootReady) {
    return <View style={{ flex: 1, backgroundColor: t.canvas }} />;
  }

  return (
    <>
      <StatusBar style={t.isDark ? 'light' : 'dark'} backgroundColor={t.canvas} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.canvas },
          // No slide transitions: an unrequested horizontal sweep is the most common
          // vestibular trigger in mobile UI, and this app has no navigation to speak of.
          animation: t.motion.enabled ? 'fade' : 'none',
        }}
      />
    </>
  );
}
