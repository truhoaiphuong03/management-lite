// Normative UI Design Tokens per docs/canonical/docs/44_UIREVIEW_NORMATIVE_DESIGN_SYSTEM.md
// Enhanced for MGL-UI-DESIGN-SYSTEM-31 (Dark Premium Canonical Design System)

export const TOKENS = {
  colors: {
    // Core surfaces and canvases
    background: '#0B1220',
    surface: '#151F30',
    surfaceSubtle: '#0F172A',
    surfaceHover: '#1E293B',
    surfaceActive: '#24334C',
    overlay: 'rgba(11, 18, 32, 0.85)',

    // Primary brand accents (Teal)
    primary: '#14B8A6',
    primaryHover: '#0D9488',
    primaryActive: '#0F766E',
    primarySubtle: 'rgba(20, 184, 166, 0.15)',

    // Secondary surfaces and accents
    secondary: '#151F30',
    secondaryHover: '#1E293B',
    secondaryActive: '#24334C',

    // Text hierarchy
    text: '#F8FAFC',
    textSecondary: '#CBD5E1',
    muted: '#94A3B8',
    disabled: '#64748B',
    inverse: '#0B1220',

    // Borders and focus rings
    border: '#334155',
    borderSubtle: '#1E293B',
    borderHover: '#475569',
    focusRing: '#14B8A6',

    // Semantic status colors
    error: '#EF4444',
    danger: '#EF4444',
    dangerHover: '#DC2626',
    dangerActive: '#B91C1C',
    dangerSubtle: 'rgba(239, 68, 68, 0.15)',

    warning: '#F59E0B',
    warningHover: '#D97706',
    warningActive: '#B45309',
    warningSubtle: 'rgba(245, 158, 11, 0.15)',

    success: '#10B981',
    successHover: '#059669',
    successActive: '#047857',
    successSubtle: 'rgba(16, 185, 129, 0.15)',

    info: '#38BDF8',
    infoHover: '#0284C7',
    infoSubtle: 'rgba(56, 189, 248, 0.15)',
  },
  spacing: {
    0: '0px',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
  },
  radii: {
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
    full: '9999px',
  },
  touchTarget: {
    minHeight: '44px',
    minWidth: '44px',
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    fontFamilyMono:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: {
      xs: '11px',
      sm: '12px',
      base: '13px',
      md: '14px',
      lg: '16px',
      xl: '18px',
      '2xl': '22px',
      '3xl': '26px',
    },
    fontWeight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      extrabold: 800,
    },
    lineHeight: {
      tight: 1.2,
      snug: 1.35,
      normal: 1.5,
      relaxed: 1.6,
    },
    letterSpacing: {
      tight: '-0.02em',
      snug: '-0.015em',
      normal: '0em',
      wide: '0.04em',
    },
    numericVariant: 'tabular-nums',
  },
  shadows: {
    sm: '0 1px 2px 0 rgba(0, 0, 0, 0.3)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.4)',
    xl: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
  },
  motion: {
    transitionFast: '100ms ease',
    transitionBase: '150ms ease',
    transitionSmooth: '200ms ease',
    spinKeyframe: 'spin 0.8s linear infinite',
  },
} as const;

/**
 * Theme-aware color references (CSS custom properties from tokens.css with the
 * dark-theme hex as fallback). Components must use these instead of TOKENS.colors
 * so that Light / Dark / System themes all render correctly.
 */
const CSS_VAR_BY_COLOR: Record<string, string> = {
  background: '--bg-color',
  surface: '--surface-color',
  surfaceSubtle: '--surface-subtle',
  surfaceHover: '--surface-hover',
  surfaceActive: '--surface-active',
  overlay: '--overlay-bg',
  primary: '--primary-color',
  primaryHover: '--primary-hover',
  primaryActive: '--primary-active',
  primarySubtle: '--primary-subtle',
  secondary: '--secondary-color',
  secondaryHover: '--secondary-hover',
  secondaryActive: '--secondary-active',
  text: '--text-color',
  textSecondary: '--text-secondary',
  muted: '--muted-color',
  disabled: '--disabled-color',
  inverse: '--inverse-text',
  border: '--border-color',
  borderSubtle: '--border-subtle',
  borderHover: '--border-hover',
  focusRing: '--focus-ring',
  error: '--error-color',
  danger: '--danger-color',
  dangerHover: '--danger-hover',
  dangerActive: '--danger-active',
  dangerSubtle: '--danger-subtle',
  warning: '--warning-color',
  warningHover: '--warning-hover',
  warningActive: '--warning-active',
  warningSubtle: '--warning-subtle',
  success: '--success-color',
  successHover: '--success-hover',
  successActive: '--success-active',
  successSubtle: '--success-subtle',
  info: '--info-color',
  infoHover: '--info-hover',
  infoSubtle: '--info-subtle',
};

export const THEME_COLORS = Object.fromEntries(
  Object.entries(TOKENS.colors).map(([key, hex]) => [
    key,
    CSS_VAR_BY_COLOR[key] ? `var(${CSS_VAR_BY_COLOR[key]}, ${hex})` : hex,
  ]),
) as Record<keyof typeof TOKENS.colors, string>;

export type ThemeTokens = typeof TOKENS;
