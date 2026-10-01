/**
 * Typed text.
 *
 * Every piece of text in MAGI goes through here, for three reasons:
 *   · the type scale and line spacing come from the user's preferences, not from literals
 *   · `allowFontScaling` stays on, so the OS text-size setting is honoured everywhere
 *   · the contrast band (body vs large) is derived from the *resolved* size, so a caption
 *     scaled up to 24px is correctly allowed the lower target while a heading scaled down
 *     is not
 *
 * There is deliberately no `fontSize` prop. If a size is needed that the scale does not
 * have, the scale is wrong.
 */

import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme } from '@/theme';
import type { TypeRole } from '@/theme/typography';

type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

// `role` is omitted from TextProps as well as `style`: React Native has its own ARIA
// `role` prop, and ours is a typography role. Keeping both would silently shadow one.
export interface AppTextProps extends Omit<TextProps, 'style' | 'role'> {
  role?: TypeRole;
  weight?: Weight;
  /** Semantic colour role. Defaults to primary ink. */
  tone?: 'ink' | 'muted' | 'subtle' | 'inverse' | 'inherit';
  /** Explicit colour, for text on a coloured wash where the pair is already audited. */
  color?: string;
  align?: TextStyle['textAlign'];
  style?: TextStyle | TextStyle[];
  /** Marks the text as a heading for assistive technology, with a level. */
  headingLevel?: 1 | 2 | 3;
}

export function AppText({
  role = 'body',
  weight = 'regular',
  tone = 'ink',
  color,
  align,
  style,
  headingLevel,
  children,
  ...rest
}: AppTextProps) {
  const t = useTheme();
  const resolved = t.type(role, weight);

  const toneColor =
    color ??
    (tone === 'muted'
      ? t.inkMuted
      : tone === 'subtle'
        ? t.inkSubtle
        : tone === 'inverse'
          ? t.inkInverse
          : tone === 'inherit'
            ? undefined
            : t.ink);

  return (
    <RNText
      allowFontScaling
      // Roles map to the platform's own heading semantics so VoiceOver and TalkBack can
      // offer heading navigation rather than making the user swipe through every line.
      accessibilityRole={headingLevel ? 'header' : rest.accessibilityRole}
      aria-level={headingLevel}
      style={[
        {
          fontSize: resolved.fontSize,
          lineHeight: resolved.lineHeight,
          letterSpacing: resolved.letterSpacing,
          fontWeight: resolved.fontWeight,
          fontFamily: t.fontFamilyFor(weight),
          color: toneColor,
          textAlign: align,
        },
        style as TextStyle,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
