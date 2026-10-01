/**
 * Labelled text input.
 *
 * The label is a real, visible label rather than a placeholder. Placeholder-as-label fails
 * WCAG 3.3.2 and, more practically, disappears the moment someone starts typing — which is
 * exactly when a user with working-memory difficulty needs it most.
 */

import { useState } from 'react';
import { TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { AppText } from './Text';

export interface FieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field. Also becomes the accessibility hint. */
  help?: string;
  error?: string;
  optional?: boolean;
  style?: ViewStyle;
}

export function Field({ label, help, error, optional, style, ...rest }: FieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const body = t.type('body');

  return (
    <View style={[{ gap: t.space.xxs }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.space.xs }}>
        <AppText role="label" weight="semibold">
          {label}
        </AppText>
        {optional ? (
          <AppText role="caption" tone="subtle">
            optional
          </AppText>
        ) : null}
      </View>

      <TextInput
        allowFontScaling
        accessibilityLabel={label}
        accessibilityHint={help}
        // The border is the affordance here, so it uses the asserted 3:1 token.
        style={{
          minHeight: t.touch.min,
          borderWidth: focused ? 2 : 1.5,
          borderColor: error ? t.role.critical.edgeStrong : focused ? t.focusRing : t.lineStrong,
          borderRadius: t.radius.md,
          paddingHorizontal: t.space.sm,
          paddingVertical: t.space.xs,
          backgroundColor: t.surface,
          color: t.ink,
          fontSize: body.fontSize,
          lineHeight: body.lineHeight,
          fontFamily: t.fontFamilyFor(),
        }}
        placeholderTextColor={t.inkSubtle}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        {...rest}
      />

      {error ? (
        <AppText role="caption" color={t.role.critical.onWash} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : help ? (
        <AppText role="caption" tone="muted">
          {help}
        </AppText>
      ) : null}
    </View>
  );
}
