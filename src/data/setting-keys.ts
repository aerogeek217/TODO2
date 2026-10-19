/**
 * Centralized setting keys persisted in the `settings` table.
 *
 * Three call sites consume these:
 *   - `stores/settings-store.ts` (read/write)
 *   - `data/import-validation.ts` (allowlist + per-key validation)
 *   - `data/database.ts` (status-seed sentinel reads/writes)
 *
 * Adding a setting means adding one row here and updating those three sites.
 * Per-theme color keys (`color.<theme>.<colorKey>`) are not enumerated; they
 * use a structured prefix recognized by the load loop.
 */
export const SETTING_KEYS = {
  themeMode: 'themeMode',
  defaultStatusId: 'defaultStatusId',
  quickStatusId: 'quickStatusId',
  seededAssignedStatusId: 'seededAssignedStatusId',
  completedRetentionDays: 'completedRetentionDays',
  weekStartsOn: 'weekStartsOn',
  /** Default next-follow-up interval for new tasks / "Mark followed up", compact form (`1m`, `2w`, `10d`). */
  followupDefaultInterval: 'followupDefaultInterval',
  /**
   * "Due date makes a task urgent": days ahead (`0` = today) or `off`.
   * Absent = the default (3 days).
   */
  urgentDueWithinDays: 'urgentDueWithinDays',
  /**
   * Hot rule: JSON array of lines, each an object of markers set to `true`
   * (`[{"urgent":true,"important":true},{"focus":true}]`). Absent = that default.
   */
  hotRule: 'hotRule',
  /** How a check-in email opens: `mailto` (open, then paste) or `eml` (download a draft). Absent = `mailto`. */
  checkinOpenMethod: 'checkinOpenMethod',
  /**
   * Which open tasks a check-in email covers: `all`, `due-soon`, `hot` or
   * `list:<listDefinitionId>`. Absent = `all`; a deleted list reads as `all`.
   */
  checkinTaskScope: 'checkinTaskScope',
  /** Id of the workspace layout that is open (a `layouts` row). */
  activeLayoutId: 'activeLayoutId',
  /**
   * The user's keyboard shortcut changes: JSON object of chord texts by
   * binding id (`{"command-palette":"Mod-Shift-p","open-settings":"g o"}`,
   * `utils/shortcut-bindings`). Only changed bindings; absent = all defaults.
   */
  keyboardShortcuts: 'keyboardShortcuts',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/** Allowlist used by import validation; mirrors `Object.values(SETTING_KEYS)`. */
export const ALL_SETTING_KEYS: readonly SettingKey[] = Object.values(SETTING_KEYS)
