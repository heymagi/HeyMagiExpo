/**
 * Motion.
 *
 * Every animation in MAGI must have a still equivalent. `reduceMotion` is honoured from
 * three sources, any of which is enough to disable movement: the OS setting, MAGI's own
 * setting, and MAGI's crisis state (nothing moves while someone is in acute distress —
 * the orb goes still and stays still).
 *
 * WCAG 2.2 2.3.3 Animation from Interactions (AAA) requires that motion animation
 * triggered by interaction can be disabled. 2.2.2 requires anything auto-moving for more
 * than 5 seconds be pausable — which is why the ambient orb breathing is gated on this
 * flag rather than running unconditionally.
 */

export const DURATION = {
  instant: 0,
  fast: 140,
  base: 220,
  slow: 340,
  deliberate: 520,
  /** One full inhale-exhale of the ambient orb. */
  breath: 5200,
} as const;

/**
 * Easing curves as cubic-bezier control points, for reanimated's Easing.bezier(...).
 * `settle` is the house curve: quick to leave, unhurried to arrive.
 */
export const EASING = {
  settle: [0.22, 1, 0.36, 1] as const,
  enter: [0.16, 0.84, 0.44, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
  breathe: [0.37, 0, 0.63, 1] as const,
} as const;

export interface MotionConfig {
  enabled: boolean;
  duration: typeof DURATION;
  easing: typeof EASING;
}

/** Collapses every duration to 0 when motion is off, so call sites need no branching. */
export function motionConfig(enabled: boolean): MotionConfig {
  if (enabled) return { enabled, duration: DURATION, easing: EASING };
  const stilled = Object.fromEntries(
    Object.keys(DURATION).map((k) => [k, 0]),
  ) as unknown as typeof DURATION;
  return { enabled, duration: stilled, easing: EASING };
}

/** Haptics intensity. Some users find haptics grounding; others find them intolerable. */
export type HapticLevel = 'off' | 'light' | 'full';
export const HAPTIC_LABELS: Record<HapticLevel, string> = {
  off: 'Off',
  light: 'Light',
  full: 'Full',
};
