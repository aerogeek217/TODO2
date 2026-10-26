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
  seededAssignedStatusId: 'seededAssignedStatusId',
  completedRetentionDays: 'completedRetentionDays',
  weekStartsOn: 'weekStartsOn',
  /** Default next-follow-up interval for new tasks / "Mark followed up", compact form (`1m`, `2w`, `10d`). */
  followupDefaultInterval: 'followupDefaultInterval',
  /**
   * "Set a next follow-up automatically" (the key predates its wider
   * meaning): whether new tasks and "Mark followed up" set the next
   * follow-up to today + the default interval (off: new tasks get none, Mark
   * followed up clears it). `false` = off; absent (or `true`) = on.
   */
  newTaskFollowup: 'newTaskFollowup',
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
   * Which of a person's open tasks a check-in email covers: JSON of a list
   * predicate without a people filter (`data/checkin-filter-shape`).
   * Absent = no filter (all their open tasks).
   */
  checkinTaskFilter: 'checkinTaskFilter',
  /** Id of the workspace layout that is open (a `layouts` row). */
  activeLayoutId: 'activeLayoutId',
  /**
   * The user's keyboard shortcut changes: JSON object of chord texts by
   * binding id (`{"command-palette":"Mod-Shift-p","open-settings":"g o"}`,
   * `utils/shortcut-bindings`). Only changed bindings; absent = all defaults.
   */
  keyboardShortcuts: 'keyboardShortcuts',
  /**
   * The Eisenhower panes (every Eisenhower tab and the dashboard section):
   * JSON object of the panes that differ from their defaults, by position —
   * `{"delegate":{"name":"Hand off","filter":{…}}}` (`data/eisenhower-shape`).
   * Absent = the four default quadrants.
   */
  eisenhowerPanes: 'eisenhowerPanes',
  /**
   * Which tasks the Eisenhower considers: `list:<listDefinitionId>` — its
   * own list (`owner: { eisenhower: true }`). The app makes and names it
   * when it is missing or names another list (app startup, a data replace —
   * `listDefinitionRepository.ensureEisenhowerList`); `all` (older data)
   * reads as no list yet.
   */
  eisenhowerSource: 'eisenhowerSource',
  /** What a new blank list sorts by (a `TodoSortBy`). Absent = `manual`. */
  newListSort: 'newListSort',
  /**
   * Which way a new blank list sorts: `desc` (only stored for a sort with a
   * direction). Absent = `asc`.
   */
  newListSortDirection: 'newListSortDirection',
  /** What a new blank list groups by (a `TodoGroupBy`). Absent = `none`. */
  newListGroup: 'newListGroup',
  /**
   * The fewest days between two launch prompts about deleting old completed
   * tasks: a whole number 1–365. Absent = 7.
   */
  purgePromptIntervalDays: 'purgePromptIntervalDays',
  /** When the launch prompt about deleting old completed tasks last showed (an ISO date-time). Absent = never. */
  purgePromptLastAt: 'purgePromptLastAt',
  /**
   * "Fade tasks untouched for": days without a change after which an open
   * task's row is drawn faded — a whole number 0–365, `0` = off. Absent = 30.
   */
  staleAfterDays: 'staleAfterDays',
  /** Row density of the desktop task rows: `comfortable` (titles wrap to two lines) or `compact`. Absent = `compact`. */
  rowDensity: 'rowDensity',
  /**
   * The lenses (named screen filters, picked per layout): JSON array of
   * `{ id, name, predicate }`, the predicate a list predicate with
   * completed tasks off (`data/lens-shape`). Absent = none.
   */
  lenses: 'lenses',
  /**
   * The preset lenses were seeded (the first open of Settings › Lenses):
   * `true`. Absent = not yet; nothing seeds them again once set.
   */
  lensPresetsSeeded: 'lensPresetsSeeded',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/**
 * Settings the app writes for itself while nobody changed anything — the
 * purge prompt's last showing. With file sync, writing one is no unsynced
 * browser change (it reaches the file with the next save, if sync is on),
 * and the browser and the file aren't compared on them: a prompt shown
 * while sync waits never makes the two sides conflict.
 */
export const SYNC_NEUTRAL_SETTING_KEYS: ReadonlySet<string> = new Set<string>([SETTING_KEYS.purgePromptLastAt])

/** Allowlist used by import validation; mirrors `Object.values(SETTING_KEYS)`. */
export const ALL_SETTING_KEYS: readonly SettingKey[] = Object.values(SETTING_KEYS)
