/**
 * Spacing, radii, elevation and touch targets.
 *
 * Touch targets: WCAG 2.2 adds 2.5.8 Target Size (Minimum) at 24x24 CSS px for AA, and
 * 2.5.5 Target Size (Enhanced) at 44x44 for AAA. We take 44 as the floor everywhere
 * rather than treating it as the enhanced case, because the audience includes users with
 * dyspraxia and users interacting one-handed while dysregulated. `large` raises it to 56.
 */

export type TouchSize = 'standard' | 'large';

export const SPACE = {
  none: 0,
  hair: 2,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 44,
  huge: 64,
} as const;

export const RADIUS = {
  none: 0,
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const TOUCH: Record<TouchSize, { min: number; padding: number; gap: number }> = {
  standard: { min: 44, padding: 12, gap: 8 },
  large: { min: 56, padding: 16, gap: 12 },
};

/**
 * Elevation. Kept shallow deliberately: heavy drop shadows read as visual noise and
 * several of our users find strong depth cues disorienting. Colour comes from the theme
 * so the dark modes do not glow.
 */
export interface Elevation {
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export const ELEVATION: Record<'flat' | 'raised' | 'floating' | 'modal', Elevation> = {
  flat: { shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  raised: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 3, elevation: 1 },
  floating: { shadowOffset: { width: 0, height: 4 }, shadowOpacity: 1, shadowRadius: 12, elevation: 5 },
  modal: { shadowOffset: { width: 0, height: 12 }, shadowOpacity: 1, shadowRadius: 28, elevation: 14 },
};

/** Focus indicator. WCAG 2.2 2.4.13 wants a focus ring at least 2px thick. */
export const FOCUS = {
  width: 3,
  offset: 2,
  radiusBump: 3,
} as const;

/** Maximum comfortable measure for body copy, in px. Long lines cost tracking effort. */
export const MAX_MEASURE = 640;
