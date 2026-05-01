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
  defaultProjectId: 'defaultProjectId',
  defaultStatusId: 'defaultStatusId',
  quickStatusId: 'quickStatusId',
  seededAssignedStatusId: 'seededAssignedStatusId',
  seededFollowupStatusId: 'seededFollowupStatusId',
  completedRetentionDays: 'completedRetentionDays',
  weekStartsOn: 'weekStartsOn',
  canvasViewport: 'canvasViewport',
  horizonSlots: 'horizonSlots',
  selectedHorizonDefId: 'selectedHorizonDefId',
  canvasRails: 'canvasRails',
  maxTags: 'maxTags',
  defaultProjectGroupBy: 'defaultProjectGroupBy',
  canvasMaxExtent: 'canvasMaxExtent',
} as const

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]

/** Allowlist used by import validation; mirrors `Object.values(SETTING_KEYS)`. */
export const ALL_SETTING_KEYS: readonly SettingKey[] = Object.values(SETTING_KEYS)
