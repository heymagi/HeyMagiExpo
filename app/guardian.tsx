/**
 * Guardian consent, for under-16s.
 *
 * The young person nominates the adult and can see and revoke the link at any time. The adult
 * verifies by email; the token is hashed before storage so a database read cannot be used to
 * approve a link.
 *
 * What the adult gets is deliberately narrow, and it is spelled out on this screen so that
 * both parties understand it before anyone agrees to anything: they are told if MAGI is
 * seriously worried, and nothing else. No transcripts, no mood history, no usage reports.
 * Anything more and a 14-year-old would — entirely reasonably — stop being honest, at which
 * point the app is worse than useless to her.
 */

import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldCheck, Mail } from 'lucide-react-native';
import { AppText } from '@/components/ui/Text';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useTheme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

const RELATIONSHIPS = [
  { value: 'parent', label: 'Parent' },
  { value: 'carer', label: 'Carer' },
  { value: 'guardian', label: 'Guardian' },
  { value: 'other_trusted_adult', label: 'Another adult I trust' },
] as const;

export default function Guardian() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAccount, signOut } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] =
    useState<(typeof RELATIONSHIPS)[number]['value']>('parent');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !email.includes('@')) {
      setError('MAGI needs their name and an email address that works.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const expires = new Date();
      expires.setDate(expires.getDate() + 14);

      const { error: insertError } = await supabase.from('guardian_link').insert({
        minor_account_id: user!.id,
        guardian_name: name.trim(),
        guardian_email: email.trim(),
        relationship,
        state: 'invited',
        verification_sent_at: new Date().toISOString(),
        verification_expires_at: expires.toISOString(),
      });
      if (insertError) throw insertError;

      // The token is minted and emailed by a server-side function, never by the client, so
      // the young person's device never holds a value that would let it self-approve.
      await supabase.functions.invoke('guardian-invite', {
        body: { guardian_email: email.trim(), guardian_name: name.trim() },
      });

      setSent(true);
      await refreshAccount();
    } catch {
      setError('That didn’t send. Check the email address and try again.');
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
      {sent ? (
        <>
          <ShieldCheck size={40} color={t.accent.green.onWash} aria-hidden />
          <AppText role="title" weight="bold" headingLevel={1}>
            Sent to {name}
          </AppText>
          <AppText role="body" tone="muted">
            They’ve got an email explaining what MAGI is and what they’re agreeing to. Once
            they’ve said yes, you’re in.
          </AppText>
          <AppText role="bodySmall" tone="muted">
            You can change who this is, or remove them, whenever you like — it’s in settings.
          </AppText>
          <Button
            label="Check again"
            variant="secondary"
            fullWidth
            onPress={() => void refreshAccount()}
          />
          <Button label="Sign out for now" variant="quiet" fullWidth onPress={() => void signOut()} />
        </>
      ) : (
        <>
          <AppText role="title" weight="bold" headingLevel={1}>
            One adult, just to say it’s okay
          </AppText>
          <AppText role="body" tone="muted">
            Because you’re under 16, MAGI needs a grown-up to agree first. Pick someone you
            actually trust.
          </AppText>

          <View
            style={{
              padding: t.space.md,
              borderRadius: t.radius.lg,
              backgroundColor: t.accent.green.wash,
              borderWidth: 1,
              borderColor: t.accent.green.edge,
              gap: t.space.xs,
            }}
          >
            <AppText role="label" weight="semibold" color={t.accent.green.onWash}>
              What they will and won’t see
            </AppText>
            <AppText role="bodySmall" color={t.accent.green.onWash}>
              They <AppText role="bodySmall" weight="bold" color={t.accent.green.onWash}>will</AppText>{' '}
              be told if MAGI is seriously worried about your safety, and MAGI will tell you at
              the same time.
            </AppText>
            <AppText role="bodySmall" color={t.accent.green.onWash}>
              They{' '}
              <AppText role="bodySmall" weight="bold" color={t.accent.green.onWash}>
                will not
              </AppText>{' '}
              see your messages, MAGI’s replies, what you’ve tracked, or when you use the app.
              There is no way for them to look.
            </AppText>
          </View>

          <Field label="Their name" value={name} onChangeText={setName} autoComplete="name" />
          <Field
            label="Their email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <View style={{ gap: t.space.xs }}>
            <AppText role="label" weight="semibold">
              Who are they to you?
            </AppText>
            <View style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap' }}>
              {RELATIONSHIPS.map((r) => (
                <Chip
                  key={r.value}
                  label={r.label}
                  selected={relationship === r.value}
                  onPress={() => setRelationship(r.value)}
                />
              ))}
            </View>
          </View>

          {error ? (
            <AppText
              role="bodySmall"
              color={t.role.critical.onWash}
              accessibilityLiveRegion="assertive"
            >
              {error}
            </AppText>
          ) : null}

          <Button
            label="Send it to them"
            variant="primary"
            fullWidth
            loading={busy}
            icon={<Mail size={16} color={t.accent.green.onSolid} aria-hidden />}
            onPress={submit}
          />

          <AppText role="caption" tone="subtle">
            If there isn’t an adult you can ask, you don’t have to manage on your own — Childline
            is free on 0800 1111, any time, and they won’t tell anyone you called.
          </AppText>
          <View style={{ flex: 1 }} />
        </>
      )}
    </ScrollView>
  );
}
