// Normative UI Design Tokens per docs/canonical/docs/44_UIREVIEW_NORMATIVE_DESIGN_SYSTEM.md

export const TOKENS = {
  colors: {
    background: '#0B1220',
    surface: '#151F30',
    primary: '#14B8A6',
    primaryHover: '#0D9488',
    text: '#F8FAFC',
    muted: '#94A3B8',
    border: '#334155',
    error: '#EF4444',
    warning: '#F59E0B',
    success: '#10B981',
  },
  spacing: {
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    6: '24px',
    8: '32px',
  },
  radii: {
    sm: '8px',
    md: '12px',
    lg: '16px',
  },
  touchTarget: {
    minHeight: '44px',
    minWidth: '44px',
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
} as const;

export type ThemeTokens = typeof TOKENS;
