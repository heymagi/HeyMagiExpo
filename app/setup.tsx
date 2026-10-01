/**
 * Setup.
 *
 * Three questions, every one skippable, and a visible way out on every screen. The research
 * finding this is built around is blunt: users often lack the capacity to articulate how they
 * feel, and a long form at the front door is where they leave. So MAGI learns the rest through
 * conversation, and this exists only to avoid the first exchange being an interrogation.
 *
 * "Skip all of this" is a first-class button, not a greyed-out link. The app is fully
 * functional with an empty profile — that is a requirement of the schema, and it is tested.
 */

import { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '@/components/ui/Text';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useTheme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { NEUROTYPES } from '@/supabase/functions/_shared/taxonomy.ts';

const SUPPORT_STYLES = [
  { value: 'warm', label: 'Hear me first', hint: 'Recognition before suggestions' },
  { value: 'practical', label: 'Give me the step', hint: 'Brief, then something concrete' },
  { value: 'brief', label: 'As few words as possible', hint: 'A sentence or two, no more' },
  { value: 'curious', label: 'Help me think', hint: 'Ask me a good question' },
] as const;

/** Plain-language labels: the taxonomy's clinical strings are not what people call themselves. */
const NEUROTYPE_LABELS: Record<string, string> = {
  'ADHD-Inattentive': 'ADHD (inattentive)',
  'ADHD-Hyperactive': 'ADHD (hyperactive)',
  'ADHD-Combined': 'ADHD (both)',
  Autism: 'Autistic',
  'ADHD-Autism': 'AuDHD',
  PDA: 'PDA',
  'Dyslexia-ADHD': 'Dyslexia + ADHD',
  Dyspraxia: 'Dyspraxia',
  'Sensory Processing Disorder': 'Sensory processing',
  'OCD-ADHD': 'OCD + ADHD',
};

export default function Setup() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshAccount } = useAuth();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [neurotypes, setNeurotypes] = useState<string[]>([]);
  const [style, setStyle] = useState<(typeof SUPPORT_STYLES)[number]['value']>('warm');
  const [busy, setBusy] = useState(false);

  const finish = async (opts?: { skipAll?: boolean }) => {
    setBusy(true);
    try {
      await supabase
        .from('profile')
        .update(
          opts?.skipAll
            ? { onboarding_completed_at: new Date().toISOString() }
            : {
                preferred_name: name.trim() || null,
                neurotypes,
                // Self-identification is accepted without diagnosis: a large share of
                // neurodivergent women are undiagnosed and gating support on a diagnosis
                // would exclude exactly the people this product is for.
                self_identified_only: neurotypes.length > 0 ? true : null,
                support_style: style,
                onboarding_completed_at: new Date().toISOString(),
              },
        )
        .eq('account_id', user!.id);
      await refreshAccount();
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
      <View
        accessible
        accessibilityLabel={`Step ${step + 1} of 3`}
        style={{ flexDirection: 'row', gap: t.space.xxs }}
      >
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={{
              height: 4,
              flex: 1,
              borderRadius: 2,
              backgroundColor: i <= step ? t.accent.green.solid : t.line,
            }}
          />
        ))}
      </View>

      {step === 0 ? (
        <>
          <AppText role="title" weight="bold" headingLevel={1}>
            What should MAGI call you?
          </AppText>
          <Field
            label="Your name"
            help="Whatever you actually go by."
            optional
            value={name}
            onChangeText={setName}
            autoComplete="given-name"
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <AppText role="title" weight="bold" headingLevel={1}>
            How does your brain work?
          </AppText>
          <AppText role="body" tone="muted">
            Pick anything that fits. You don’t need a diagnosis, and you can change this
            whenever.
          </AppText>
          <View style={{ flexDirection: 'row', gap: t.space.xs, flexWrap: 'wrap' }}>
            {NEUROTYPES.map((n) => (
              <Chip
                key={n}
                label={NEUROTYPE_LABELS[n] ?? n}
                selected={neurotypes.includes(n)}
                accent="sage"
                onPress={() =>
                  setNeurotypes((prev) =>
                    prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
                  )
                }
              />
            ))}
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <AppText role="title" weight="bold" headingLevel={1}>
            When things are hard, what helps?
          </AppText>
          <View style={{ gap: t.space.xs }}>
            {SUPPORT_STYLES.map((s) => (
              <Chip
                key={s.value}
                label={s.label}
                selected={style === s.value}
                accent="amber"
                accessibilityHint={s.hint}
                onPress={() => setStyle(s.value)}
                style={{ alignSelf: 'flex-start' }}
              />
            ))}
          </View>
          <AppText role="caption" tone="muted">
            MAGI will adjust as she gets to know you, whatever you pick here.
          </AppText>
        </>
      ) : null}

      <View style={{ flex: 1 }} />

      <View style={{ gap: t.space.sm }}>
        {step < 2 ? (
          <Button
            label="Next"
            variant="primary"
            fullWidth
            onPress={() => setStep((s) => s + 1)}
          />
        ) : (
          <Button
            label="Start talking to MAGI"
            variant="primary"
            fullWidth
            loading={busy}
            onPress={() => void finish()}
          />
        )}
        <Button
          label="Skip all of this"
          variant="quiet"
          fullWidth
          disabled={busy}
          accessibilityHint="MAGI works perfectly well without any of it"
          onPress={() => void finish({ skipAll: true })}
        />
      </View>
    </ScrollView>
  );
}
