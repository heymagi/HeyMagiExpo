/**
 * WCAG 2.x relative-luminance contrast maths, for runtime and test use.
 *
 * The generated tokens are already proven at build time (tools/build_theme.py). These
 * helpers exist so that anything computed at runtime — a colour derived from user data,
 * a chart series, a dynamically tinted card — can be checked too, and so the dev build
 * can shout when a component invents a colour pair that has not been through the audit.
 */

export type ContrastKind = 'body' | 'large' | 'ui';

/** WCAG large text: >= 24px, or >= 18.66px when bold. */
export const LARGE_TEXT_PX = 24;
export const LARGE_TEXT_BOLD_PX = 18.66;

export function parseColor(input: string): [number, number, number] {
  const s = input.trim();

  const hex = s.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  const rgb = s.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [parts[0], parts[1], parts[2]];
  }

  throw new Error(`parseColor: unsupported colour "${input}"`);
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: string): number {
  const [r, g, b] = parseColor(color);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

export function requiredRatio(kind: ContrastKind, highContrast: boolean): number {
  if (kind === 'ui') return 3;
  if (highContrast) return kind === 'body' ? 7 : 4.5;
  return kind === 'body' ? 4.5 : 3;
}

export function meetsContrast(
  foreground: string,
  background: string,
  kind: ContrastKind,
  highContrast: boolean,
): boolean {
  return contrastRatio(foreground, background) >= requiredRatio(kind, highContrast);
}

export function classifyTextKind(fontSizePx: number, bold: boolean): ContrastKind {
  const threshold = bold ? LARGE_TEXT_BOLD_PX : LARGE_TEXT_PX;
  return fontSizePx >= threshold ? 'large' : 'body';
}

/**
 * Dev-only guard. Logs rather than throwing, so a colour mistake never crashes the app
 * in front of a user who may be in distress.
 */
export function assertContrastInDev(
  label: string,
  foreground: string,
  background: string,
  kind: ContrastKind,
  highContrast: boolean,
): void {
  if (!__DEV__) return;
  try {
    const ratio = contrastRatio(foreground, background);
    const need = requiredRatio(kind, highContrast);
    if (ratio < need) {
      console.warn(
        `[a11y] ${label}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, ` +
          `needs ${need}:1 for "${kind}" text${highContrast ? ' in high-contrast mode' : ''}.`,
      );
    }
  } catch (err) {
    console.warn(`[a11y] ${label}: could not check contrast — ${String(err)}`);
  }
}
