/**
 * Type scale.
 *
 * Two things drive size here, and they multiply:
 *   1. `textSize` — MAGI's own in-app preference, for users who do not know how to change
 *      their OS setting or who want the app larger than everything else.
 *   2. The OS font scale, honoured by React Native automatically. We do NOT disable
 *      `allowFontScaling` anywhere, which is why every layout must reflow rather than
 *      relying on fixed heights.
 *
 * WCAG 2.2 1.4.12 (Text Spacing) requires that content survive line-height of 1.5x the
 * font size, so 1.5 is the floor for body copy, not a maximum.
 */

export type TextSize = 'standard' | 'large' | 'larger' | 'largest';
export type LineSpacing = 'standard' | 'relaxed' | 'loose';

/** Multipliers applied on top of the OS font scale. */
export const TEXT_SIZE_SCALE: Record<TextSize, number> = {
  standard: 1,
  large: 1.15,
  larger: 1.32,
  largest: 1.5,
};

export const LINE_SPACING_MULTIPLIER: Record<LineSpacing, number> = {
  standard: 1.5,
  relaxed: 1.7,
  loose: 1.9,
};

export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  standard: 'Standard',
  large: 'Large',
  larger: 'Larger',
  largest: 'Largest',
};

export const LINE_SPACING_LABELS: Record<LineSpacing, string> = {
  standard: 'Standard',
  relaxed: 'Relaxed',
  loose: 'Loose',
};

/**
 * Base sizes in px at textSize = 'standard'.
 *
 * `display` and `title` are deliberately the only steps above the WCAG large-text
 * threshold of 24px, so it is unambiguous which roles may use the lower contrast target.
 */
export const BASE_SIZES = {
  display: 34,
  title: 26,
  heading: 21,
  subheading: 18,
  body: 16.5,
  bodySmall: 15,
  label: 14,
  caption: 13,
} as const;

export type TypeRole = keyof typeof BASE_SIZES;

export const WEIGHTS = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Letter-spacing in px. Slight negative tracking on large text, open tracking on labels. */
export const TRACKING: Record<TypeRole, number> = {
  display: -0.6,
  title: -0.4,
  heading: -0.2,
  subheading: -0.1,
  body: 0,
  bodySmall: 0,
  label: 0.2,
  caption: 0.2,
};

export interface ResolvedTypeStyle {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: (typeof WEIGHTS)[keyof typeof WEIGHTS];
  /** Which WCAG contrast band this role falls into once scaled. */
  contrastKind: 'body' | 'large';
}

export function resolveTypeStyle(
  role: TypeRole,
  textSize: TextSize,
  lineSpacing: LineSpacing,
  weight: keyof typeof WEIGHTS = 'regular',
): ResolvedTypeStyle {
  const fontSize = Math.round(BASE_SIZES[role] * TEXT_SIZE_SCALE[textSize] * 100) / 100;
  const bold = weight === 'bold' || weight === 'semibold';
  const largeThreshold = bold ? 18.66 : 24;
  return {
    fontSize,
    lineHeight: Math.round(fontSize * LINE_SPACING_MULTIPLIER[lineSpacing] * 100) / 100,
    letterSpacing: TRACKING[role],
    fontWeight: WEIGHTS[weight],
    contrastKind: fontSize >= largeThreshold ? 'large' : 'body',
  };
}

/**
 * Font stacks.
 *
 * `system` keeps the platform's own face, which is what most users have already tuned.
 * `hyperlegible` is Atkinson Hyperlegible, designed by the Braille Institute with
 * deliberately distinguishable letterforms — it is the single most requested typographic
 * accommodation among readers with low vision, and it also helps some dyslexic readers.
 */
export type FontChoice = 'system' | 'hyperlegible' | 'mono';

export const FONT_FAMILIES: Record<FontChoice, string | undefined> = {
  system: undefined,
  hyperlegible: 'AtkinsonHyperlegible',
  mono: 'AtkinsonHyperlegibleMono',
};

export const FONT_LABELS: Record<FontChoice, string> = {
  system: 'Your device font',
  hyperlegible: 'Atkinson Hyperlegible',
  mono: 'Fixed width',
};
