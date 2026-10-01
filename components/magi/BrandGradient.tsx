/**
 * The brand's signature sunset wash.
 *
 * The marketing site is pale pistachio at the top fading into yellow, orange and magenta at
 * the bottom. The app shipped with the brand's deep green and none of this, which is why it
 * read as a monochrome green product rather than as MAGI.
 *
 * Purely decorative:
 *   · it never sits behind body text — content is above it and text contrast is measured
 *     against `canvas`, which the gradient only tints at the very bottom of the screen
 *   · it does not intercept touches
 *   · `plainBackgrounds` removes it entirely, for users who find large colour fields
 *     distracting rather than pleasant
 */

import { View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/theme';

export type BrandGradientVariant =
  /**
   * The site's full device: pale mint at the top warming down through yellow and orange to
   * magenta at the bottom. For screens with no pinned composer.
   */
  | 'sunset'
  /**
   * A warm halo at the top, behind the orb. Yellow into amber only, no magenta — the full
   * sunset at the top of the conversation screen put the hottest colour behind the orb and
   * under the settings button, which muddied both.
   */
  | 'halo';

export interface BrandGradientProps {
  variant?: BrandGradientVariant;
  /** Fraction of screen height the wash occupies. */
  height?: number;
}

export function BrandGradient({ variant = 'halo', height }: BrandGradientProps) {
  const t = useTheme();
  const { height: screenHeight } = useWindowDimensions();

  if (t.plainBackgrounds) return null;

  const g = t.brandGradient;
  const isSunset = variant === 'sunset';
  const fraction = height ?? (isSunset ? 0.6 : 0.34);
  const gradientHeight = Math.round(screenHeight * fraction);

  return (
    <View
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        ...(isSunset ? { bottom: 0 } : { top: 0 }),
        height: gradientHeight,
        // The halo is deliberately weaker: it sits behind the orb and the settings control
        // rather than in empty space.
        opacity: isSunset ? g.opacity : g.opacity * 0.62,
        pointerEvents: 'none',
      }}
    >
      <LinearGradient
        // Transparent at the content end, so text keeps the mint ground its contrast was
        // measured against.
        colors={isSunset ? ['transparent', g.from, g.via, g.to] : [g.via, g.from, 'transparent']}
        locations={isSunset ? [0, 0.4, 0.7, 1] : [0, 0.45, 1]}
        style={{ flex: 1 }}
      />
    </View>
  );
}
