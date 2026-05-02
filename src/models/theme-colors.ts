/**
 * Theme color types + default seed values. Lives in `models/` so non-store
 * layers (data seeds, components reading hex fallbacks) can import the
 * defaults without dragging the settings-store closure in.
 *
 * The light seeds mirror `tokens.css`'s `[data-theme="light"]` block — these
 * are the values applied by the theme stylesheet when the user has no
 * overrides; surfacing them in the editor lets a user re-tune light mode
 * without pulling dark-tuned values into it.
 */
export interface ThemeColors {
  accent: string
  canvasBg: string
  surface: string
  border: string
  header: string
  danger: string
  warning: string
  star: string
  scheduled: string
  deadline: string
}

export interface ThemedColors {
  dark: ThemeColors
  light: ThemeColors
}

export type ThemeName = 'dark' | 'light'

export const DEFAULT_THEMED_COLORS: ThemedColors = {
  dark: {
    accent: '#a2cfcb',
    canvasBg: '#0e0e0e',
    surface: '#191a1a',
    border: '#302e2b',
    header: '#1f2120',
    danger: '#ee7d77',
    warning: '#f5a623',
    star: '#f5c842',
    scheduled: '#7ec4bc',
    deadline: '#e86bf0',
  },
  light: {
    accent: '#3a9e93',
    canvasBg: '#f5f4f2',
    surface: '#ffffff',
    border: '#d9d5d0',
    header: '#f7fbfa',
    danger: '#d94a43',
    warning: '#d08a12',
    star: '#c09a15',
    scheduled: '#3a9e93',
    deadline: '#b838c0',
  },
}
