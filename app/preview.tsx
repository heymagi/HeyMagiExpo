/**
 * Design preview of the main screen, with sample content and no backend.
 *
 * The real screen sits behind sign-in, age assurance and a database, so until the client's
 * Supabase project is live there is no way to look at the thing we are actually building.
 * This renders the same components — orb, conversation, cards, composer, support panel —
 * against fixed sample turns, so the product surface can be reviewed and shown to people.
 *
 * Not reachable in a production build: it redirects to the real screen unless __DEV__.
 * It talks to nothing and writes nothing.
 */

import { useState } from 'react';
import { View, Pressable, ScrollView } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Settings2 } from 'lucide-react-native';

import { MagiOrb } from '@/components/magi/MagiOrb';
import { BrandGradient } from '@/components/magi/BrandGradient';
import { Composer } from '@/components/magi/Composer';
import { SupportPanel } from '@/components/magi/SupportPanel';
import { SettingsSheet } from '@/components/magi/SettingsSheet';
import { MagiCardView } from '@/components/magi/cards';
import { AppText } from '@/components/ui/Text';
import { Chip } from '@/components/ui/Chip';
import { useTheme } from '@/theme';
import { resourcesForAge } from '@/supabase/functions/_shared/crisis-resources.ts';
import type { MagiCard } from '@/supabase/functions/_shared/types.ts';

type Scene = 'ordinary' | 'quiet';

const CHECK_IN_CARD: MagiCard = {
  id: 'p1',
  kind: 'check_in_logged',
  data: { overall: 'rough', note: 'barely got through the standup', signal_count: 2, local_date: '2026-09-01' },
  accessibleSummary: 'Today logged as rough, with your note. You can change it any time.',
};

const CHALLENGE_CARD: MagiCard = {
  id: 'p2',
  kind: 'challenge',
  data: {
    instance_id: 'x',
    title: 'Ten minutes unmasked',
    invitation: 'For ten minutes, drop the performance. Stim, slump, stare, script nothing.',
    detail: 'Alone, door shut. Masking is genuine physical work and this is the only rest from it.',
    offered_because: 'You said the meetings were the worst part, and that is where masking costs most.',
  },
  accessibleSummary:
    'Ten minutes unmasked. For ten minutes, drop the performance. You can take it, leave it, or come back to it.',
};

const INSIGHT_CARD: MagiCard = {
  id: 'p3',
  kind: 'insight_proposal',
  proposal: {
    proposal_id: 'p3',
    tool: 'propose_insight',
    input: {},
    accept_label: 'That fits',
    reject_label: "That's not it",
  },
  data: {
    observation:
      'You may notice the hardest days tend to land in the few days before your period — four of the last five you rated rough were in that window.',
    based_on: { check_ins: 22, rough_days: 5, in_luteal_window: 4, period_covered: '30 days' },
    period_start: '2026-08-02',
    period_end: '2026-09-01',
  },
  accessibleSummary:
    'Something MAGI noticed: the hardest days tend to land in the few days before your period. You can accept it or say it does not fit.',
};

const MEMORY_CARD: MagiCard = {
  id: 'p4',
  kind: 'memory_saved',
  data: { id: 'm', kind: 'support', value: 'Cold water on her wrists works when nothing else does', provenance: 'stated' },
  accessibleSummary: 'MAGI has noted: cold water on her wrists works when nothing else does',
};

const SCENES: Record<Scene, { turns: { author: 'user' | 'magi'; body: string; cards: MagiCard[] }[] }> = {
  ordinary: {
    turns: [
      { author: 'user', body: "Today's been rough.", cards: [] },
      {
        author: 'magi',
        body: "That's twice this week. Rough is allowed to just be rough — you don't owe me a reason for it.",
        cards: [CHECK_IN_CARD],
      },
      { author: 'user', body: 'Three meetings back to back and I could not keep the mask up by the third one', cards: [] },
      {
        author: 'magi',
        body: "Three in a row with no gap between them is a lot of holding it together, Ellie. No wonder the third one gave.",
        cards: [CHALLENGE_CARD, MEMORY_CARD],
      },
      { author: 'user', body: 'is it always this bad around now', cards: [] },
      {
        author: 'magi',
        body: 'Let me look at what you have actually logged rather than guess.',
        cards: [INSIGHT_CARD],
      },
    ],
  },
  quiet: {
    turns: [
      { author: 'user', body: 'i cant do this anymore', cards: [] },
      {
        author: 'magi',
        body: "I'm here. Stay with me for a minute.\n\nCold water on the inside of your wrists — you told me that one works. Thirty seconds is enough.",
        cards: [],
      },
    ],
  },
};

export default function Preview() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  // ?scene=quiet opens straight into the distress state, which is handy for review and
  // for screenshotting without having to drive the UI.
  const params = useLocalSearchParams<{ scene?: string }>();
  const [scene, setScene] = useState<Scene>(params.scene === 'quiet' ? 'quiet' : 'ordinary');
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!__DEV__) return <Redirect href="/" />;

  const quiet = scene === 'quiet';
  const turns = SCENES[scene].turns;

  return (
    <View style={{ flex: 1, backgroundColor: t.canvas }}>
      <BrandGradient variant="halo" />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: t.space.lg,
          paddingBottom: t.space.xxl,
          gap: t.space.lg,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            paddingTop: insets.top + t.space.xl,
            paddingBottom: t.space.md,
            gap: t.space.sm,
          }}
        >
          <MagiOrb state={quiet ? 'quiet' : 'idle'} />
        </View>

        {/* Preview-only scene switch. Never present on the real screen. */}
        <View style={{ flexDirection: 'row', gap: t.space.xs, justifyContent: 'center' }}>
          <Chip label="Ordinary day" selected={!quiet} onPress={() => setScene('ordinary')} />
          <Chip label="In distress" selected={quiet} accent="rose" onPress={() => setScene('quiet')} />
        </View>

        {turns.map((turn, i) =>
          turn.author === 'user' ? (
            <View key={i} style={{ alignItems: 'flex-end' }}>
              <View
                style={{
                  maxWidth: '86%',
                  // Mirrors Conversation.tsx: the brand's deep green card, not a wash.
                  backgroundColor: t.accent.green.solid,
                  borderColor: t.accent.green.solid,
                  borderWidth: 1,
                  borderRadius: t.radius.lg,
                  borderBottomRightRadius: t.radius.xs,
                  paddingHorizontal: t.space.md,
                  paddingVertical: t.space.sm,
                }}
              >
                <AppText role="body" color={t.accent.green.onSolid}>
                  {turn.body}
                </AppText>
              </View>
            </View>
          ) : (
            <View key={i} style={{ gap: t.space.sm, maxWidth: t.maxMeasure }}>
              <AppText role="body">{turn.body}</AppText>
              {turn.cards.map((card) => (
                <MagiCardView key={card.id} card={card} onResolve={() => undefined} />
              ))}
            </View>
          ),
        )}
      </ScrollView>

      {quiet ? (
        <SupportPanel
          resources={resourcesForAge(31, false)}
          onClose={() => undefined}
          urgent={false}
        />
      ) : null}

      <Composer onSend={() => undefined} busy={false} quiet={quiet} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        onPress={() => setSettingsOpen(true)}
        style={{
          position: 'absolute',
          top: insets.top + t.space.xs,
          right: t.space.md,
          width: t.touch.min,
          height: t.touch.min,
          borderRadius: t.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.surface,
          borderWidth: 1,
          borderColor: t.line,
          ...t.shadow('floating'),
        }}
      >
        <Settings2 size={20} color={t.ink} aria-hidden />
      </Pressable>

      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </View>
  );
}
