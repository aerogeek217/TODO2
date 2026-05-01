/**
 * Route paths used by the HashRouter in App.tsx. Centralized so navigation
 * call sites (Sidebar, BottomTabBar, command-registry, keyboard-shortcuts)
 * stay in sync with the `<Route>` declarations.
 */
export const ROUTE_CANVAS = '/'
export const ROUTE_LIST = '/list'
export const ROUTE_CALENDAR = '/calendar'
export const ROUTE_SETTINGS = '/settings'

export type AppRoute =
  | typeof ROUTE_CANVAS
  | typeof ROUTE_LIST
  | typeof ROUTE_CALENDAR
  | typeof ROUTE_SETTINGS
