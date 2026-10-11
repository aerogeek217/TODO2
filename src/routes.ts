/**
 * Route paths used by the hash router in App.tsx. Centralized so navigation
 * call sites (Sidebar, BottomTabBar, command-registry, keyboard-shortcuts)
 * stay in sync with the `<Route>` declarations.
 */
export const ROUTE_WORKSPACE = '/'
export const ROUTE_SETTINGS = '/settings'

/** Former page routes; each redirects to the workspace. */
export const LEGACY_ROUTES: readonly string[] = ['/workspace', '/list', '/calendar', '/dashboard']

export type AppRoute =
  | typeof ROUTE_WORKSPACE
  | typeof ROUTE_SETTINGS
