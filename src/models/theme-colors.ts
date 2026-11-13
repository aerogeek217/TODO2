/**
 * Theme color types + default seed values. Lives in `models/` so non-store
 * layers (data seeds, components reading hex fallbacks) can import the
 * defaults without dragging the settings-store closure in.
 *
 * The seeds mirror `tokens.css` (the dark block and the
 * `[data-theme="light"]` block) — the values the theme stylesheet applies
 * when the user has no overrides — so the editor shows the colours in use.
 * A priority's seed is the seed of the colour it follows there
 * (`THEME_COLOR_FOLLOWS`).
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
  /** The three priorities' colors (a task's ring, glow and row cue, the editor's toggles, the menus). */
  focus: string
  urgent: string
  important: string
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
    focus: '#7ec4bc',
    urgent: '#ee7d77',
    important: '#f5c842',
  },
  light: {
    accent: '#2f9a8f',
    appBg: '#f7f6f3',
    surface: '#fcfbf9',
    border: '#dedad4',
    header: '#f3f1ed',
    danger: '#d94a43',
    warning: '#d08a12',
    star: '#826600',
    deadline: '#a32cab',
    focus: '#2f9a8f',
    urgent: '#d94a43',
    important: '#826600',
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
  focus: '--color-marker-focus',
  urgent: '--color-marker-urgent',
  important: '--color-marker-important',
}

/**
 * The colours that, with no override of their own, are another theme colour
 * (the stylesheet's `--color-marker-urgent: var(--color-danger)`): a priority
 * follows the accent, Danger or Follow up — an override of that one too —
 * until it is given its own.
 */
export const THEME_COLOR_FOLLOWS: Readonly<Partial<Record<keyof ThemeColors, keyof ThemeColors>>> = {
  focus: 'accent',
  urgent: 'danger',
  important: 'star',
}

/**
 * What a priority's own colour sets besides its `--color-marker-*`: the fill
 * of its typed token's tint (`/urgent`, Quick Add's chip — the colour at
 * `PRIORITY_TINT_FILL`) and, for Focus, the token's text. Without an
 * override the stylesheet has them follow Danger's, Follow up's and the
 * accent's own.
 */
export const PRIORITY_TINT_VARS: Readonly<Partial<Record<keyof ThemeColors, { fill: string; text?: string }>>> = {
  focus: { fill: '--color-marker-focus-bg', text: '--color-marker-focus-text' },
  urgent: { fill: '--color-marker-urgent-bg' },
  important: { fill: '--color-marker-important-bg' },
}

/** How much of a priority's own colour its token's fill is. */
export const PRIORITY_TINT_FILL = '12%'

/**
 * The colour `key` is drawn in: its own value once overridden (`customized`),
 * else the value of the colour it follows, else its seed (`colors` holds the
 * seeds of the colours without an override).
 */
export function themeColorShown(colors: ThemeColors, customized: readonly (keyof ThemeColors)[], key: keyof ThemeColors): string {
  const follows = THEME_COLOR_FOLLOWS[key]
  return follows !== undefined && !customized.includes(key) ? colors[follows] : colors[key]
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
