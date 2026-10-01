/**
 * The conversation.
 *
 * Choices worth naming:
 *   · MAGI's words are not in a bubble. Her replies read as text on the page, which keeps the
 *     screen calm and makes her feel present rather than like a chat widget. Only the user's
 *     own messages are enclosed, so she can find what she said.
 *   · New content is announced through a live region as well as the explicit announcement in
 *     MagiContext, because Android and iOS pick these up differently.
 *   · Auto-scroll is suppressed when motion is reduced: an animated jump is exactly the kind
 *     of unrequested movement WCAG 2.3.3 is about.
 */

import { useEffect, useRef } from 'react';
import { ScrollView, View, Pressable } from 'react-native';
import { RotateCcw } from 'lucide-react-native';
import { AppText } from '@/components/ui/Text';
import { useTheme } from '@/theme';
import { MagiCardView } from './cards';
import type { Turn } from '@/contexts/MagiContext';
import type { MagiCard } from '@/supabase/functions/_shared/types.ts';

export interface ConversationProps {
  turns: Turn[];
  busy: boolean;
  onResolve: (
    card: MagiCard,
    decision: 'accept' | 'reject',
    editedInput?: Record<string, unknown>,
  ) => void;
  onRetry: () => void;
  /** Rendered above the first turn — the orb and greeting. */
  header?: React.ReactNode;
}

export function Conversation({ turns, busy, onResolve, onRetry, header }: ConversationProps) {
  const t = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const lastCount = useRef(turns.length);

  useEffect(() => {
    if (turns.length === lastCount.current) return;
    lastCount.current = turns.length;
    const timer = setTimeout(
      () => scrollRef.current?.scrollToEnd({ animated: t.motion.enabled }),
      60,
    );
    return () => clearTimeout(timer);
  }, [turns.length, t.motion.enabled]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: t.space.lg,
        paddingBottom: t.space.xxl,
        gap: t.space.lg,
      }}
      keyboardShouldPersistTaps="handled"
      // Region rather than list: the content is a conversation, not a set of equal items.
      accessibilityRole="none"
      accessibilityLabel="Your conversation with MAGI"
    >
      {header}

      {turns.map((turn) =>
        turn.author === 'user' ? (
          <UserTurn key={turn.id} turn={turn} onRetry={onRetry} />
        ) : (
          <MagiTurn key={turn.id} turn={turn} busy={busy} onResolve={onResolve} />
        ),
      )}

      {busy ? <Thinking /> : null}
    </ScrollView>
  );
}

function UserTurn({ turn, onRetry }: { turn: Turn; onRetry: () => void }) {
  const t = useTheme();
  const failed = turn.status === 'failed';
  const sending = turn.status === 'sending';

  return (
    <View style={{ alignItems: 'flex-end', gap: t.space.xxs }}>
      <View
        accessible
        accessibilityLabel={`You said: ${turn.body}${failed ? '. Not sent.' : ''}`}
        style={{
          maxWidth: '86%',
          // The brand uses deep green as a filled card with white text. Using it here for
          // the user's own words gives the screen its contrast and frees the pale washes
          // for MAGI's cards, which is what stops everything reading as one green.
          backgroundColor: t.accent.green.solid,
          borderColor: failed ? t.role.critical.edgeStrong : t.accent.green.solid,
          borderWidth: failed ? 2 : 1,
          borderRadius: t.radius.lg,
          borderBottomRightRadius: t.radius.xs,
          paddingHorizontal: t.space.md,
          paddingVertical: t.space.sm,
          opacity: sending ? 0.6 : 1,
        }}
      >
        <AppText role="body" color={t.accent.green.onSolid}>
          {turn.body}
        </AppText>
      </View>

      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send that message again"
          onPress={onRetry}
          style={{
            minHeight: t.touch.min,
            flexDirection: 'row',
            alignItems: 'center',
            gap: t.space.xxs,
            paddingHorizontal: t.space.xs,
          }}
        >
          <RotateCcw size={14} color={t.role.critical.onWash} aria-hidden />
          <AppText role="caption" weight="semibold" color={t.role.critical.onWash}>
            Didn’t send — try again
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function MagiTurn({
  turn,
  busy,
  onResolve,
}: {
  turn: Turn;
  busy: boolean;
  onResolve: ConversationProps['onResolve'];
}) {
  const t = useTheme();

  return (
    <View style={{ gap: t.space.sm, maxWidth: t.maxMeasure }}>
      <AppText
        role="body"
        accessibilityLabel={`MAGI: ${turn.body}`}
        accessibilityLiveRegion="polite"
      >
        {turn.body}
      </AppText>

      {turn.cards.map((card) => (
        <MagiCardView key={card.id} card={card} onResolve={onResolve} busy={busy} />
      ))}
    </View>
  );
}

/**
 * Three dots would be a lie about how long this takes. A single line of honest text costs
 * nothing to read and does not imply imminence.
 */
function Thinking() {
  const t = useTheme();
  return (
    <View accessibilityLiveRegion="polite" accessibilityLabel="MAGI is thinking">
      <AppText role="bodySmall" tone="subtle">
        thinking…
      </AppText>
    </View>
  );
}
