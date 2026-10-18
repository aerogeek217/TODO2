/**
 * Theme color types + default seed values. Lives in `models/` so non-store
 * layers (data seeds, components reading hex fallbacks) can import the
 * defaults without dragging the settings-store closure in.
 *
 * The seeds mirror `tokens.css` (the dark block and the
 * `[data-theme="light"]` block) — the values the theme stylesheet applies
 * when the user has no overrides — so the editor shows the colours in use.
 */
export interface ThemeColors {
  accent: string
  appBg: string
  surface: string
  border: string
  header: string
  danger: string
  warning: string
  star: string
  deadline: string
}

export interface ThemedColors {
  dark: ThemeColors
  light: ThemeColors
}

export type ThemeName = 'dark' | 'light'

export const DEFAULT_THEMED_COLORS: ThemedColors = {
  dark: {
    accent: '#7ec4bc',
    appBg: '#111110',
    surface: '#1a1918',
    border: '#302e2b',
    header: '#1f2120',
    danger: '#ee7d77',
    warning: '#f5a623',
    star: '#f5c842',
    deadline: '#e86bf0',
  },
  light: {
    accent: '#3a9e93',
    appBg: '#f5f4f2',
    surface: '#ffffff',
    border: '#d9d5d0',
    header: '#f7fbfa',
    danger: '#d94a43',
    warning: '#d08a12',
    star: '#826600',
    deadline: '#b838c0',
  },
}

/** The CSS custom property each theme colour overrides (as an inline style on `<html>`). */
export const THEME_COLOR_VARS: Readonly<Record<keyof ThemeColors, string>> = {
  accent: '--color-accent',
  appBg: '--color-app-bg',
  surface: '--color-surface',
  border: '--color-border',
  header: '--color-header-bg',
  danger: '--color-danger',
  warning: '--color-warning',
  star: '--color-followup',
  deadline: '--color-deadline',
}

const THEME_NAMES: readonly ThemeName[] = ['dark', 'light']

/**
 * The theme and colour a `color.<theme>.<name>` settings key stands for, or
 * `null` when it isn't one: an unknown theme, or a name that isn't one of
 * `ThemeColors`' own keys (so `color.dark.constructor` / `__proto__` are not
 * colours).
 */
export function parseColorSettingKey(key: string): { theme: ThemeName; name: keyof ThemeColors } | null {
  const [prefix, theme, name, ...extra] = key.split('.')
  if (prefix !== 'color' || name === undefined || extra.length > 0) return null
  const t = THEME_NAMES.find((n) => n === theme)
  if (!t || !Object.hasOwn(DEFAULT_THEMED_COLORS[t], name)) return null
  return { theme: t, name: name as keyof ThemeColors }
}
