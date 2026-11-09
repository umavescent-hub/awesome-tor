/**
 * Folio design tokens. One dark, warm palette — turquoise accent drawn from Pueblo jewelry,
 * category hues from chile, corn, clay and sky. Every UI colour comes from here.
 */
import { Platform, type TextStyle } from 'react-native';

export const color = {
  bg: '#0C0B0A',
  surface: '#161412',
  elevated: '#201D1A',
  pressed: '#2A2622',
  border: '#2E2A25',
  hairline: 'rgba(245, 241, 234, 0.08)',
  text: '#F5F1EA',
  textMuted: '#A8A198',
  textFaint: '#6F6A63',
  accent: '#2BB3A3',
  accentPressed: '#24998B',
  accentInk: '#04201D',
  accentSoft: 'rgba(43, 179, 163, 0.14)',
  success: '#5DC28F',
  warning: '#E3B451',
  danger: '#E2553F',
  scrim: 'rgba(0, 0, 0, 0.6)',
} as const;

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

/** Screen side gutter. */
export const GUTTER = space.lg;

export const radius = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

const fontFamily = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
});

const t = (size: number, lineHeight: number, fontWeight: TextStyle['fontWeight'], extra?: TextStyle): TextStyle => ({
  fontFamily,
  fontSize: size,
  lineHeight,
  fontWeight,
  color: color.text,
  ...extra,
});

export const type = {
  display: t(30, 36, '800', { letterSpacing: -0.6 }),
  title: t(22, 28, '700', { letterSpacing: -0.3 }),
  heading: t(17, 22, '700', { letterSpacing: -0.1 }),
  body: t(15, 21, '400'),
  bodyStrong: t(15, 21, '600'),
  caption: t(13, 18, '400', { color: color.textMuted }),
  captionStrong: t(13, 18, '600', { color: color.textMuted }),
  micro: t(11, 14, '700', { color: color.textMuted, letterSpacing: 1.1, textTransform: 'uppercase' }),
} as const;

export const motion = {
  fast: 120,
  base: 220,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
