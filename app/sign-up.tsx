import { useState } from 'react';
import { View, ScrollView, Linking, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/Text';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useTheme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';

/** Version strings are recorded with the consent, so a policy change invalidates stale consent. */
const TERMS_VERSION = '2026-09-01';
const PRIVACY_VERSION = '2026-09-01';

export default function SignUp() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const weak = password.length > 0 && password.length < 10;

  const submit = async () => {
    if (!agreed || weak) return;
    setBusy(true);
    setError(null);
    try {
      await signUp(email, password);
      // Consent rows are written after the account exists, from the age-check screen, where
      // we also know whether a guardian needs to give it.
    } catch (err) {
      setError(
        err instanceof Error && /already/i.test(err.message)
          ? 'There’s already an account with that email. Try signing in.'
          : 'That didn’t work. Check the email address and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1,
        backgroundColor: t.canvas,
        paddingHorizontal: t.space.xl,
        paddingTop: insets.top + t.space.xxl,
        paddingBottom: insets.bottom + t.space.xl,
        gap: t.space.lg,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <AppText role="title" weight="bold" headingLevel={1}>
        Let’s get you set up
      </AppText>

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        help="At least 10 characters. Longer beats complicated."
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={weak ? 'A bit longer, please — 10 characters or more.' : (error ?? undefined)}
      />

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.space.sm }}>
        <Chip
          label={agreed ? 'Agreed' : 'Tap to agree'}
          selected={agreed}
          onPress={() => setAgreed((v) => !v)}
          accessibilityHint="You must agree to the terms and privacy notice to create an account"
        />
        <AppText role="caption" tone="muted" style={{ flex: 1 }}>
          I agree to the{' '}
          <AppText
            role="caption"
            weight="semibold"
            onPress={() => Linking.openURL('https://heymagi.com/terms').catch(() => undefined)}
            accessibilityRole="link"
          >
            terms
          </AppText>{' '}
          and the{' '}
          <AppText
            role="caption"
            weight="semibold"
            onPress={() => Linking.openURL('https://heymagi.com/privacy').catch(() => undefined)}
            accessibilityRole="link"
          >
            privacy notice
          </AppText>
          , including MAGI holding health information about me so it can support me.
        </AppText>
      </View>

      <Button
        label="Create account"
        variant="primary"
        fullWidth
        loading={busy}
        disabled={!agreed || !email || password.length < 10}
        onPress={submit}
      />
      <Button
        label="I already have an account"
        variant="quiet"
        fullWidth
        onPress={() => router.replace('/sign-in')}
      />
      <View style={{ flex: 1 }} />
    </ScrollView>
  );
}

export { TERMS_VERSION, PRIVACY_VERSION };
