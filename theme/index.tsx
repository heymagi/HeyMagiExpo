/**
 * The single source of visual truth for MAGI.
 *
 * Replaces the previous ThemeContext + AccessibilityContext pair, which disagreed with
 * each other: the old ThemeContext shipped five hand-written palettes (none of them
 * contrast-audited) while AccessibilityContext kept its own separate `highContrast` flag
 * that no palette actually read.
 *
 * Everything here is one resolved object. A component asks for `t.ink` or
 * `t.accent.rose.wash` and gets a value that has already been proven against its
 * background at build time.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, useColorScheme, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { THEME_TOKENS } from './tokens.generated';
import {
  type TextSize,
  type LineSpacing,
  type FontChoice,
  type TypeRole,
  type ResolvedTypeStyle,
  resolveTypeStyle,
  FONT_FAMILIES,
  LINE_SPACING_MULTIPLIER,
} from './typography';
import { SPACE, RADIUS, TOUCH, ELEVATION, FOCUS, MAX_MEASURE, type TouchSize } from './space';
import { motionConfig, type MotionConfig, type HapticLevel } from './motion';

export type ColourScheme = 'system' | 'light' | 'dark';
type TokenMode = 'light' | 'lightHigh' | 'dark' | 'darkHigh';

export interface Preferences {
  colourScheme: ColourScheme;
  /** Raises every text contrast target from AA (4.5:1) to AAA (7:1). */
  highContrast: boolean;
  textSize: TextSize;
  lineSpacing: LineSpacing;
  font: FontChoice;
  touchSize: TouchSize;
  /** User's own motion preference. The OS setting can also disable motion. */
  reduceMotion: boolean;
  haptics: HapticLevel;
  /** Hides decorative gradients and imagery for users who find them distracting. */
  plainBackgrounds: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  colourScheme: 'system',
  highContrast: false,
  textSize: 'standard',
  lineSpacing: 'standard',
  font: 'system',
  touchSize: 'standard',
  reduceMotion: false,
  haptics: 'light',
  plainBackgrounds: false,
};

type AccentName = 'green' | 'sage' | 'rose' | 'amber' | 'yellow' | 'pink';
type RoleName = 'positive' | 'growth' | 'critical' | 'caution' | 'highlight' | 'gentle';

type AccentTokens = (typeof THEME_TOKENS)['modes']['light']['accent']['green'];
type ModeTokens = (typeof THEME_TOKENS)['modes']['light'];
type BrandGradientTokens = (typeof THEME_TOKENS)['modes']['light']['brandGradient'];

export interface Theme {
  mode: TokenMode;
  isDark: boolean;
  highContrast: boolean;

  canvas: string;
  canvasSunken: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  inkInverse: string;
  line: string;
  lineStrong: string;
  focusRing: string;
  focusRingOffset: string;
  scrim: string;
  shadowColor: string;

  accent: Record<AccentName, AccentTokens>;
  role: Record<RoleName, AccentTokens>;
  /** Decorative only — never carries text. See components/magi/BrandGradient. */
  brandGradient: BrandGradientTokens;

  space: typeof SPACE;
  radius: typeof RADIUS;
  touch: (typeof TOUCH)['standard'];
  elevation: typeof ELEVATION;
  focus: typeof FOCUS;
  maxMeasure: number;

  motion: MotionConfig;
  haptics: HapticLevel;
  plainBackgrounds: boolean;

  fontFamily: string | undefined;
  /**
   * The family to use at a given weight. One family today, because the three built-in
   * choices each carry their own weights; the brand faces will need a real per-weight
   * lookup here, which is why call sites already ask through this rather than reading
   * `fontFamily` directly.
   */
  fontFamilyFor: (weight?: 'regular' | 'medium' | 'semibold' | 'bold') => string | undefined;
  /** Resolved text style for a role, already scaled by the user's preferences. */
  type: (role: TypeRole, weight?: 'regular' | 'medium' | 'semibold' | 'bold') => ResolvedTypeStyle;
  lineSpacingMultiplier: number;

  /** Shadow style ready to spread onto a View. */
  shadow: (level: keyof typeof ELEVATION) => object;
}

interface ThemeContextValue {
  theme: Theme;
  preferences: Preferences;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  resetPreferences: () => void;
  /** True once persisted preferences have loaded — avoids a flash of the wrong theme. */
  ready: boolean;
  /** OS-level reduce-motion, exposed so settings can explain why motion is already off. */
  osReduceMotion: boolean;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'magi.preferences.v1';

function tokenMode(isDark: boolean, highContrast: boolean): TokenMode {
  if (isDark) return highContrast ? 'darkHigh' : 'dark';
  return highContrast ? 'lightHigh' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [osReduceMotion, setOsReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          setPreferences({ ...DEFAULT_PREFERENCES, ...JSON.parse(raw) });
        }
      } catch {
        // A corrupt preferences blob must never block the app from opening.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => !cancelled && setOsReduceMotion(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOsReduceMotion);
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  const setPreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((prev) => {
        const next = { ...prev, [key]: value };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
        return next;
      });
    },
    [],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined);
  }, []);

  const theme = useMemo<Theme>(() => {
    const isDark =
      preferences.colourScheme === 'system'
        ? systemScheme === 'dark'
        : preferences.colourScheme === 'dark';
    const mode = tokenMode(isDark, preferences.highContrast);
    const m = THEME_TOKENS.modes[mode] as unknown as ModeTokens;
    const motionEnabled = !preferences.reduceMotion && !osReduceMotion;

    const shadow = (level: keyof typeof ELEVATION) => {
      const e = ELEVATION[level];
      if (level === 'flat') return {};
      return Platform.select({
        web: {
          boxShadow: `0px ${e.shadowOffset.height}px ${e.shadowRadius}px ${m.shadowColor}`,
        },
        default: {
          shadowColor: m.shadowColor,
          shadowOffset: e.shadowOffset,
          shadowOpacity: e.shadowOpacity,
          shadowRadius: e.shadowRadius,
          elevation: e.elevation,
        },
      }) as object;
    };

    return {
      mode,
      isDark,
      highContrast: preferences.highContrast,

      canvas: m.canvas,
      canvasSunken: m.canvasSunken,
      surface: m.surface,
      surfaceRaised: m.surfaceRaised,
      surfaceSunken: m.surfaceSunken,
      ink: m.ink,
      inkMuted: m.inkMuted,
      inkSubtle: m.inkSubtle,
      inkInverse: m.inkInverse,
      line: m.line,
      lineStrong: m.lineStrong,
      focusRing: m.focusRing,
      focusRingOffset: m.focusRingOffset,
      scrim: m.scrim,
      shadowColor: m.shadowColor,

      accent: m.accent as unknown as Record<AccentName, AccentTokens>,
      role: m.role as unknown as Record<RoleName, AccentTokens>,
      brandGradient: m.brandGradient,

      space: SPACE,
      radius: RADIUS,
      touch: TOUCH[preferences.touchSize],
      elevation: ELEVATION,
      focus: FOCUS,
      maxMeasure: MAX_MEASURE,

      motion: motionConfig(motionEnabled),
      haptics: preferences.haptics,
      plainBackgrounds: preferences.plainBackgrounds,

      fontFamily: FONT_FAMILIES[preferences.font],
      fontFamilyFor: () => FONT_FAMILIES[preferences.font],
      type: (role, weight = 'regular') =>
        resolveTypeStyle(role, preferences.textSize, preferences.lineSpacing, weight),
      lineSpacingMultiplier: LINE_SPACING_MULTIPLIER[preferences.lineSpacing],

      shadow,
    };
  }, [preferences, systemScheme, osReduceMotion]);

  const value = useMemo(
    () => ({ theme, preferences, setPreference, resetPreferences, ready, osReduceMotion }),
    [theme, preferences, setPreference, resetPreferences, ready, osReduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside a ThemeProvider');
  return ctx.theme;
}

export function usePreferences() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('usePreferences must be used inside a ThemeProvider');
  const { preferences, setPreference, resetPreferences, ready, osReduceMotion } = ctx;
  return { preferences, setPreference, resetPreferences, ready, osReduceMotion };
}

export { THEME_TOKENS };
export * from './typography';
export * from './space';
export * from './motion';
export * from './contrast';
