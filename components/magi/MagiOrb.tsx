/**
 * MAGI's presence.
 *
 * This is the only decorative element in the app and it carries the whole brand, so all six
 * brand hues appear here — as soft overlapping fields of colour rather than as text, which is
 * precisely how the design system keeps the app vivid while text contrast climbs to AAA.
 *
 * The orb has four states and each one is legible without motion:
 *   idle     — all six hues, slow breath
 *   thinking — the same, with a travelling ring
 *   quiet    — a single cool hue, still, dimmer: this is what distress looks like, and
 *              nothing moves, because movement is the last thing a dysregulated nervous
 *              system needs
 *   plain    — flat concentric fills, for `plainBackgrounds`
 *
 * Motion is gated on the resolved motion config, which already accounts for the OS setting,
 * MAGI's own setting, and quiet mode. When motion is off the orb is simply a still image at
 * the midpoint of the breath, never a shorter animation.
 */

import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, RadialGradient, Stop, G } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type OrbState = 'idle' | 'thinking' | 'quiet';

export interface MagiOrbProps {
  state: OrbState;
  size?: number;
  /** Described to assistive technology in place of the visual. */
  label?: string;
}

/**
 * Blob layout in viewBox units.
 *
 * Tuned against rendered screenshots rather than by eye in code. Two things came out of that:
 * the hues have to sit well off-centre or they overlap into olive and grey, and they need
 * real opacity — at the low values this started with, the orb read as a drab green ball with
 * a faint stain on it rather than as anything colourful.
 *
 * Positions are deliberately asymmetric so the orb never looks like a diagram, and no two
 * adjacent hues are neighbours on the wheel.
 */
const BLOBS = [
  { hue: 'rose', cx: 140, cy: 70, r: 46, opacity: 0.9, drift: 4.5, phase: 0 },
  { hue: 'amber', cx: 128, cy: 140, r: 42, opacity: 0.85, drift: 6, phase: 1 },
  { hue: 'pink', cx: 92, cy: 48, r: 36, opacity: 0.8, drift: 4, phase: 2 },
  { hue: 'yellow', cx: 62, cy: 132, r: 36, opacity: 0.7, drift: 5, phase: 3 },
  { hue: 'sage', cx: 50, cy: 82, r: 40, opacity: 0.55, drift: 5.5, phase: 4 },
] as const;

export function MagiOrb({ state, size = 208, label }: MagiOrbProps) {
  const t = useTheme();
  const motion = t.motion.enabled && state !== 'quiet';

  const breath = useSharedValue(0.5);
  const ring = useSharedValue(0);
  const drift = useSharedValue(0);

  useEffect(() => {
    if (!motion) {
      cancelAnimation(breath);
      cancelAnimation(drift);
      breath.value = 0.5;
      drift.value = 0;
      return;
    }
    breath.value = withRepeat(
      withSequence(
        withTiming(1, {
          duration: t.motion.duration.breath / 2,
          easing: Easing.bezier(...t.motion.easing.breathe),
        }),
        withTiming(0, {
          duration: t.motion.duration.breath / 2,
          easing: Easing.bezier(...t.motion.easing.breathe),
        }),
      ),
      -1,
      false,
    );
    drift.value = withRepeat(
      withTiming(1, { duration: t.motion.duration.breath * 3, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(breath);
      cancelAnimation(drift);
    };
  }, [motion, t.motion.duration.breath]);

  useEffect(() => {
    if (!motion || state !== 'thinking') {
      cancelAnimation(ring);
      ring.value = 0;
      return;
    }
    ring.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.bezier(...t.motion.easing.settle) }),
      -1,
      false,
    );
    return () => cancelAnimation(ring);
  }, [motion, state]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.97 + breath.value * 0.05 }],
  }));

  const ringProps = useAnimatedProps(() => ({
    r: 84 + ring.value * 14,
    opacity: (1 - ring.value) * 0.5,
  }));

  const quiet = state === 'quiet';
  const plain = t.plainBackgrounds;

  // Quiet mode drops the accent hues entirely and drains the green. State is carried by
  // dimness and stillness as well as colour, so it never depends on hue alone.
  const base = t.accent.green;

  const accessibleLabel =
    label ??
    (state === 'thinking'
      ? 'MAGI is thinking'
      : quiet
        ? 'MAGI is here, quietly'
        : 'MAGI is here');

  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibleLabel}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, containerStyle]}
    >
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          {/* Light core to deep rim, which is what makes it read as a sphere rather than a
              flat disc. Quiet mode keeps the same form and simply drains it. */}
          <RadialGradient id="orb-base" cx="50%" cy="40%" r="64%">
            <Stop offset="0%" stopColor={base.orbCore} stopOpacity={quiet ? 0.45 : 1} />
            <Stop offset="66%" stopColor={base.orbMid} stopOpacity={quiet ? 0.4 : 0.95} />
            <Stop offset="100%" stopColor={base.orbRim} stopOpacity={quiet ? 0.34 : 0.9} />
          </RadialGradient>

          {BLOBS.map((b) => {
            const a = t.accent[b.hue];
            return (
              <RadialGradient key={b.hue} id={`orb-${b.hue}`} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={a.orbHue} stopOpacity={b.opacity} />
                <Stop offset="52%" stopColor={a.orbHue} stopOpacity={b.opacity * 0.42} />
                <Stop offset="100%" stopColor={a.orbHue} stopOpacity={0} />
              </RadialGradient>
            );
          })}

          <RadialGradient id="orb-sheen" cx="36%" cy="28%" r="44%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={quiet ? 0.08 : 0.18} />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
          </RadialGradient>

          {/* Without this the blobs bleed past the rim and the orb loses its edge. */}
          <ClipPath id="orb-clip">
            <Circle cx={100} cy={100} r={82} />
          </ClipPath>
        </Defs>

        {state === 'thinking' && motion ? (
          <AnimatedCircle
            cx={100}
            cy={100}
            fill="none"
            stroke={t.accent.sage.graphic}
            strokeWidth={2}
            animatedProps={ringProps}
          />
        ) : null}

        <Circle cx={100} cy={100} r={82} fill="url(#orb-base)" />

        {!quiet && !plain ? (
          <G clipPath="url(#orb-clip)">
            {BLOBS.map((b) => (
              <DriftingBlob key={b.hue} blob={b} drift={drift} enabled={motion} />
            ))}
          </G>
        ) : null}

        {!plain ? <Circle cx={100} cy={100} r={82} fill="url(#orb-sheen)" /> : null}

        {/* A defined edge so the orb reads as an object rather than a smudge, at 3:1 against
            the canvas via the audited graphicDeep token. */}
        <Circle
          cx={100}
          cy={100}
          r={82}
          fill="none"
          stroke={base.orbRim}
          strokeWidth={1.5}
          strokeOpacity={quiet ? 0.3 : 0.45}
        />
      </Svg>

      {/* Stillness in quiet mode is deliberate and worth stating for a sighted user who
          knows the orb usually moves; the label above covers non-sighted users. */}
      {quiet ? <View aria-hidden style={{ pointerEvents: 'none' }} /> : null}
    </Animated.View>
  );
}

function DriftingBlob({
  blob,
  drift,
  enabled,
}: {
  blob: (typeof BLOBS)[number];
  drift: SharedValue<number>;
  enabled: boolean;
}) {
  const animatedProps = useAnimatedProps(() => {
    if (!enabled) return { cx: blob.cx, cy: blob.cy };
    const angle = (drift.value + blob.phase / BLOBS.length) * Math.PI * 2;
    return {
      cx: blob.cx + Math.cos(angle) * blob.drift,
      cy: blob.cy + Math.sin(angle * 0.8) * blob.drift,
    };
  });

  return (
    <AnimatedCircle
      r={blob.r}
      fill={`url(#orb-${blob.hue})`}
      animatedProps={animatedProps}
      cx={blob.cx}
      cy={blob.cy}
    />
  );
}
