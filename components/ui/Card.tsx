/**
 * Surface container for the cards MAGI puts into the conversation.
 *
 * Accent tints come from the audited token pairs, so a card can be as colourful as the brand
 * wants while the text on it still clears 7:1 in high-contrast mode. `plainBackgrounds`
 * flattens the tint for users who find coloured panels distracting rather than helpful.
 */

import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { AppText } from './Text';

export interface CardProps {
  accent?: 'green' | 'sage' | 'rose' | 'amber' | 'yellow' | 'pink' | 'neutral';
  title?: string;
  /** Read instead of the visual arrangement. Always supply one for a MAGI card. */
  accessibleSummary?: string;
  children?: ReactNode;
  style?: ViewStyle;
}

export function Card({ accent = 'neutral', title, accessibleSummary, children, style }: CardProps) {
  const t = useTheme();
  const tinted = accent !== 'neutral' && !t.plainBackgrounds;
  const a = accent !== 'neutral' ? t.accent[accent] : null;

  return (
    <View
      // The card is announced as one thing with its summary, then explorable in detail.
      accessible={Boolean(accessibleSummary)}
      accessibilityLabel={accessibleSummary}
      style={[
        {
          backgroundColor: tinted && a ? a.wash : t.surface,
          borderColor: tinted && a ? a.edge : t.line,
          borderWidth: 1,
          borderRadius: t.radius.lg,
          padding: t.space.md,
          gap: t.space.xs,
          maxWidth: t.maxMeasure,
        },
        t.shadow('raised'),
        style,
      ]}
    >
      {title ? (
        <AppText
          role="label"
          weight="semibold"
          color={tinted && a ? a.onWash : t.inkMuted}
          style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
        >
          {title}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}
