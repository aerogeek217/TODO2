/**
 * Route paths used by the hash router in App.tsx. Centralized so navigation
 * call sites (BottomTabBar, the top bar) stay in sync with the `<Route>`
 * declarations. `/settings` is the mobile Settings page; on desktop it opens
 * the Settings modal over the workspace.
 */
export const ROUTE_WORKSPACE = '/'
export const ROUTE_SETTINGS = '/settings'

/** Former page routes; each redirects to the workspace. */
export const LEGACY_ROUTES: readonly string[] = ['/workspace', '/list', '/calendar', '/dashboard']

export type AppRoute =
  | typeof ROUTE_WORKSPACE
  | typeof ROUTE_SETTINGS

/** Route state for `/settings`: the mobile Settings page opens on `section` (e.g. from the phone's storage status sheet). */
export interface SettingsRouteState {
  section?: 'database'
}
