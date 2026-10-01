/**
 * Age assurance.
 *
 * Required because under-18s are in scope, which puts MAGI under the ICO's Age Appropriate
 * Design Code. The Code expects a proportionate estimate of age, and for a wellbeing app with
 * no purchases and no social features, self-declared date of birth with the consequences
 * clearly stated is a defensible level of assurance.
 *
 * Two design decisions worth defending:
 *
 *   · Date of birth, not an age band. Guardian obligations change on a birthday, and a stored
 *     band silently goes stale — a 15-year-old in a "13-15" bucket stays there forever.
 *   · The consequences are stated *before* the answer is given. Telling a 14-year-old only
 *     after she has typed her birthday that she now needs a parent involved is how you teach
 *     teenagers to lie about their age, which defeats the entire safeguarding purpose.
 */

import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/Text';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { TERMS_VERSION, PRIVACY_VERSION } from './sign-up';

export default function AgeCheck() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAccount } = useAuth();

  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);

    if (!d || !m || !y || y < 1900) {
      setError('Please fill in all three boxes.');
      return;
    }
    // Construct in UTC and verify the parts survived, which catches 31 February.
    const dob = new Date(Date.UTC(y, m - 1, d));
    if (dob.getUTCDate() !== d || dob.getUTCMonth() !== m - 1 || dob.getUTCFullYear() !== y) {
      setError('That date doesn’t exist. Have another look?');
      return;
    }
    if (dob.getTime() > Date.now()) {
      setError('That’s in the future.');
      return;
    }

    const age = yearsSince(dob);
    if (age < 13) {
      setError(
        'MAGI is for people aged 13 and over. If you’re younger than that, Childline is there for you any time on 0800 1111.',
      );
      return;
    }

    setBusy(true);
    try {
      const iso = dob.toISOString().slice(0, 10);
      await supabase
        .from('account')
        .update({
          date_of_birth: iso,
          date_of_birth_confirmed_at: new Date().toISOString(),
          // Under-16s wait for a verified adult; everyone else is active immediately.
          state: age < 16 ? 'pending_guardian' : 'active',
        })
        .eq('id', user!.id);

      await supabase.from('consent_record').insert([
        { account_id: user!.id, kind: 'terms', document_version: TERMS_VERSION, granted: true },
        {
          account_id: user!.id,
          kind: 'privacy_notice',
          document_version: PRIVACY_VERSION,
          granted: true,
        },
        {
          account_id: user!.id,
          kind: 'health_data_processing',
          document_version: PRIVACY_VERSION,
          granted: true,
        },
      ]);

      await refreshAccount();
    } catch {
      setError('That didn’t save. Try again?');
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
        When were you born?
      </AppText>
      <AppText role="body" tone="muted">
        MAGI works differently depending on your age, so this matters more than it looks.
      </AppText>

      <View
        style={{
          padding: t.space.md,
          borderRadius: t.radius.lg,
          backgroundColor: t.accent.sage.wash,
          borderWidth: 1,
          borderColor: t.accent.sage.edge,
          gap: t.space.xxs,
        }}
      >
        <AppText role="label" weight="semibold" color={t.accent.sage.onWash}>
          Before you answer
        </AppText>
        <AppText role="bodySmall" color={t.accent.sage.onWash}>
          If you’re under 16, you’ll need a parent or another trusted adult to say it’s okay
          before you can use MAGI.
        </AppText>
        <AppText role="bodySmall" color={t.accent.sage.onWash}>
          If you’re under 18, that adult is told if MAGI is ever seriously worried about your
          safety. They are never told what you talked about — not your messages, not MAGI’s
          replies. And MAGI tells you at the time, not afterwards.
        </AppText>
      </View>

      <View style={{ flexDirection: 'row', gap: t.space.sm }}>
        <Field
          label="Day"
          value={day}
          onChangeText={setDay}
          keyboardType="number-pad"
          maxLength={2}
          style={{ flex: 1 }}
        />
        <Field
          label="Month"
          value={month}
          onChangeText={setMonth}
          keyboardType="number-pad"
          maxLength={2}
          style={{ flex: 1 }}
        />
        <Field
          label="Year"
          value={year}
          onChangeText={setYear}
          keyboardType="number-pad"
          maxLength={4}
          style={{ flex: 1.4 }}
        />
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

      <Button label="Continue" variant="primary" fullWidth loading={busy} onPress={submit} />
      <View style={{ flex: 1 }} />
    </ScrollView>
  );
}

function yearsSince(dob: Date): number {
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}
