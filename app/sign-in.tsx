import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/Text';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';

export default function SignIn() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      // Never distinguish "no such account" from "wrong password": that difference tells an
      // attacker whether an address is registered, which for this app is health information.
      setError('That email and password don’t match. Have another go?');
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
        Welcome back
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
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        error={error ?? undefined}
      />

      <Button label="Sign in" variant="primary" fullWidth loading={busy} onPress={submit} />
      <Button
        label="I need an account"
        variant="quiet"
        fullWidth
        onPress={() => router.replace('/sign-up')}
      />
      <View style={{ flex: 1 }} />
    </ScrollView>
  );
}
