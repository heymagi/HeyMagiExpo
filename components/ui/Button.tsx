/**
 * Buttons.
 *
 * Accessibility baked in rather than remembered:
 *   · minimum target is the user's touch preference (44 or 56px), enforced on both axes
 *   · a visible focus ring for keyboard and switch-control users, which mobile RN gives you
 *     nothing for by default
 *   · `accessibilityState` reflects disabled and busy, so a screen reader announces why a
 *     tap did nothing
 *   · haptics respect the user's setting, including off
 *
 * `label` is used for both the visible text and the accessible name unless an explicit
 * `accessibilityLabel` is given, which makes an unlabelled button impossible to write.
 */

import { useState, type ReactNode } from 'react';
import {
  Pressable,
  View,
  ActivityIndicator,
  Platform,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme';
import { AppText } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: ButtonVariant;
  /** Accent to tint the button with. Defaults to green for primary, neutral otherwise. */
  accent?: 'green' | 'sage' | 'rose' | 'amber' | 'yellow' | 'pink';
  icon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  variant = 'primary',
  accent = 'green',
  icon,
  loading = false,
  fullWidth = false,
  disabled,
  onPress,
  style,
  accessibilityLabel,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const a = t.accent[accent];
  const isDisabled = disabled || loading;

  const surface: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: a.solid, fg: a.onSolid, border: a.solid },
    secondary: { bg: a.wash, fg: a.onWash, border: a.edgeStrong },
    quiet: { bg: 'transparent', fg: t.ink, border: 'transparent' },
    danger: { bg: t.role.critical.solid, fg: t.role.critical.onSolid, border: t.role.critical.solid },
  };
  const c = surface[variant];

  const handlePress: PressableProps['onPress'] = (e) => {
    if (t.haptics !== 'off') {
      const style =
        t.haptics === 'full'
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light;
      Haptics.impactAsync(style).catch(() => undefined);
    }
    onPress?.(e);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(isDisabled), busy: loading }}
      disabled={isDisabled}
      onPress={handlePress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        {
          minHeight: t.touch.min,
          minWidth: t.touch.min,
          paddingHorizontal: t.space.lg,
          paddingVertical: t.touch.padding,
          borderRadius: t.radius.pill,
          backgroundColor: c.bg,
          borderWidth: variant === 'secondary' ? 1.5 : 0,
          borderColor: c.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: t.space.xs,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
          // Opacity rather than a greyed colour, so the disabled state cannot break contrast.
          opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1,
          ...(focused
            ? {
                outlineStyle: 'solid',
                outlineWidth: t.focus.width,
                outlineColor: t.focusRing,
                outlineOffset: t.focus.offset,
              }
            : null),
        } as ViewStyle,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={c.fg} aria-hidden />
      ) : (
        icon
      )}
      <AppText role="label" weight="semibold" color={c.fg}>
        {label}
      </AppText>
      {/* Web-only focus outline needs a real element on native; this keeps parity. */}
      {Platform.OS !== 'web' && focused ? (
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
