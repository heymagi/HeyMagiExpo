/**
 * Selectable chip, used for the one-tap answers that make a check-in possible in seconds.
 *
 * Selection is conveyed three ways — fill, border weight and a check glyph — because colour
 * alone fails WCAG 1.4.1 and fails colour-blind users in practice.
 */

import { useState } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useTheme } from '@/theme';
import { AppText } from './Text';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accent?: 'green' | 'sage' | 'rose' | 'amber' | 'yellow' | 'pink';
  disabled?: boolean;
  /** Announced after the label, e.g. "2 of 5". */
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function Chip({
  label,
  selected = false,
  onPress,
  accent = 'green',
  disabled,
  accessibilityHint,
  style,
}: ChipProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const a = t.accent[accent];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        if (t.haptics !== 'off') {
          Haptics.selectionAsync().catch(() => undefined);
        }
        onPress?.();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        {
          minHeight: t.touch.min,
          paddingHorizontal: t.space.md,
          paddingVertical: t.space.xs,
          borderRadius: t.radius.pill,
          backgroundColor: selected ? a.wash : t.surface,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? a.edgeStrong : t.line,
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.space.xxs,
          opacity: disabled ? 0.45 : 1,
        } as ViewStyle,
        style,
      ]}
    >
      {selected ? (
        <Check size={16} color={a.onWash} strokeWidth={3} aria-hidden />
      ) : null}
      <AppText role="label" weight={selected ? 'semibold' : 'regular'} color={selected ? a.onWash : t.ink}>
        {label}
      </AppText>
      {focused ? (
        <View
          style={{
            pointerEvents: 'none',
            position: 'absolute',
            top: -t.focus.offset,
            left: -t.focus.offset,
            right: -t.focus.offset,
            bottom: -t.focus.offset,
            borderRadius: t.radius.pill,
            borderWidth: t.focus.width,
            borderColor: t.focusRing,
          }}
        />
      ) : null}
    </Pressable>
  );
}
