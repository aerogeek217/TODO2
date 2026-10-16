import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from './database'
import { upgradeDataSet, type DataRow, type DataSet } from './schema-upgrades'
import { MAX_IMPORT_SIZE_BYTES, MAX_RECORDS_PER_TABLE, validateImportData, type ImportData } from './import-validation'
import { detectUnsupportedImport, SCHEMA_VERSION_KEY, type UnsupportedImportInfo } from './file-version'
import { isRecord } from '../utils/is-record'

export type PrepareImportFailure =
  | 'too-large'
  | 'invalid-json'
  | 'not-object'
  | 'too-new'
  | 'upgrade-failed'
  | 'invalid'
  | 'task-archive'

/**
 * `kind` marker of a task archive: the purged-task file written by
 * "Export & delete". Same envelope as a full export (`__schemaVersion`,
 * `exportedAt`) but only the task tables — see `services/task-archive.ts`.
 * A file without `kind` is a full export.
 */
export const TASK_ARCHIVE_KIND = 'task-archive'

/**
 * What the caller will do with the data:
 * - `restore` (default): replace the whole database — needs a full export;
 *   a task archive is rejected (`task-archive`).
 * - `append`: add tasks to the current database (Settings → "Import tasks
 *   (append)…") — accepts a task archive or a full export, so the
 *   full-database requirements (tasks and settings) are not enforced.
 */
export type ImportPurpose = 'restore' | 'append'

export interface PrepareImportOptions {
  purpose?: ImportPurpose
}

export type PrepareImportResult =
  | {
      ok: true
      /** Validated, current-shape rows ready for `restoreFromImportData`. */
      data: ImportData
      /** Non-fatal notes (e.g. dropped unrecognized setting keys). */
      warnings: string[]
      /** The file's `__schemaVersion`, or `null` when the marker is missing. */
      sourceVersion: number | null
      /**
       * Non-null when the file is below the floor (or has no marker). The
       * caller MUST get the user's confirmation (`MigrationDialog`
       * `mode="legacy-import"`) before restoring `data`.
       */
      legacy: UnsupportedImportInfo | null
      /** True when the file was older than CURRENT and went through the registry. */
      upgraded: boolean
      /** `task-archive` for a purged-task archive, else `full`. */
      kind: 'full' | 'task-archive'
    }
  | { ok: false; reason: PrepareImportFailure; error: string }

/**
 * The tables a v49 export carries — the v49 build's `ALL_DATA_TABLES`, which
 * it writes in full, empty ones included. Frozen with the transforms from
 * v49 on, which were written for that shape.
 */
const V49_EXPORT_TABLES = [
  'todos', 'projects', 'canvases', 'listInsets', 'people', 'settings', 'todoPeople', 'todoOrgs', 'personOrgs',
  'orgs', 'taskboards', 'statuses', 'listDefinitions', 'notes', 'floatingCalendars', 'floatingNotes',
  'floatingTaskboards', 'floatingHorizons', 'floatingStatus', 'floatingScoreboard', 'floatingSnoozeGraveyard',
  'tags', 'todoTags', 'todoEvents',
] as const

function readKind(raw: Record<string, unknown>): 'full' | 'task-archive' {
  return raw.kind === TASK_ARCHIVE_KIND ? 'task-archive' : 'full'
}

function readSchemaVersion(raw: Record<string, unknown>): number | null {
  const v = raw[SCHEMA_VERSION_KEY]
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

/**
 * The single import entry point. Every path that turns an export /
 * backup snapshot / sync file into database rows goes through here:
 * Settings → Import JSON, backup restore (`parseAndRestore`), and
 * file-storage `loadFromFile`.
 *
 * 1. Reads `__schemaVersion`.
 *    - > `CURRENT_DB_VERSION` → rejected (`too-new`): a newer build wrote it.
 *    - missing / < floor → `legacy` info is returned; the data is still
 *      prepared (upgraded *as if* it were at the floor, then validated) so the
 *      caller only prompts for files that would actually load.
 *    - floor ≤ v < CURRENT → upgraded through `upgradeDataSet`.
 *    - = CURRENT → validated as-is.
 * 2. Validates the upgraded dataset (`validateImportData`, strict except for
 *    unrecognized setting keys, which become `warnings`).
 *
 * Task archives (`kind: 'task-archive'`) take the same path — the
 * registry transforms tolerate their missing tables — but are only accepted
 * for `purpose: 'append'`; `append` validates without the full-database
 * requirement (tasks and settings).
 *
 * Pure — no database access. Restoring / appending is the caller's job.
 */
export function prepareImport(raw: unknown, options: PrepareImportOptions = {}): PrepareImportResult {
  const purpose = options.purpose ?? 'restore'
  if (!isRecord(raw)) {
    return { ok: false, reason: 'not-object', error: 'Import data is not an object' }
  }

  const kind = readKind(raw)
  if (kind === 'task-archive' && purpose === 'restore') {
    return {
      ok: false,
      reason: 'task-archive',
      error: 'This file is a task archive, not a full backup. Use "Import tasks (append)…" in Settings to add its tasks.',
    }
  }

  const sourceVersion = readSchemaVersion(raw)
  if (sourceVersion !== null && sourceVersion > CURRENT_DB_VERSION) {
    return {
      ok: false,
      reason: 'too-new',
      error: `This file is from a newer version of TODO2 (schema v${sourceVersion}); this build supports up to v${CURRENT_DB_VERSION}. Update TODO2 to load it.`,
    }
  }

  const legacy = detectUnsupportedImport(raw)
  // Below-floor / marker-less files have no registry path; once the user
  // confirms, treat them as floor-shaped and run every transform from there.
  const fromVersion = legacy || sourceVersion === null ? OLDEST_SUPPORTED_DB_VERSION : sourceVersion

  // Split table arrays (the DataSet the transforms see) from everything else
  // (`__schemaVersion`, `exportedAt`, `savedAt`, and any malformed non-array
  // table value, which validation must still see in order to reject it).
  // Prototype-less, and a `__proto__` key (which `JSON.parse` makes an own
  // property) is no table: it is skipped, never assigned.
  const tables: DataSet = Object.create(null) as DataSet
  const rest: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__proto__') continue
    if (Array.isArray(value)) tables[key] = value as DataRow[]
    else rest[key] = value
  }

  // A full file upgraded from v49 (or treated as v49-shaped) that lacks some
  // of v49's tables is read as holding them empty, as the v49 build writes
  // them: the transforms key off a table's presence (v59 turns a rail's
  // taskboard tab into a Focus list tab only when `taskboards` is there), so
  // a missing one could leave a shape no later version accepts.
  if (kind === 'full' && fromVersion === 49) {
    for (const table of V49_EXPORT_TABLES) if (!(table in tables)) tables[table] = []
  }

  // The per-table record cap, checked before the transforms run (validation
  // checks it again on the upgraded tables): it bounds their work, and covers
  // the tables they drop (e.g. a v49 file's `orgs`), which validation never
  // sees.
  for (const [key, rows] of Object.entries(tables)) {
    if (rows.length > MAX_RECORDS_PER_TABLE) {
      return {
        ok: false,
        reason: 'invalid',
        error: `"${key}" has too many records (${rows.length}). Maximum is ${MAX_RECORDS_PER_TABLE}.`,
      }
    }
  }

  let upgradedTables: DataSet
  try {
    upgradedTables = upgradeDataSet(tables, fromVersion, CURRENT_DB_VERSION)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      reason: 'upgrade-failed',
      error: `Could not upgrade this file from schema v${fromVersion} to v${CURRENT_DB_VERSION}: ${detail}`,
    }
  }

  // `rest` last: a malformed non-array table value must reach validation even
  // if a transform defaulted the (absent-from-DataSet) table to `[]`.
  const validated = validateImportData({ ...upgradedTables, ...rest }, { requireFullDatabase: purpose === 'restore' })
  if (!validated.ok) {
    return { ok: false, reason: 'invalid', error: validated.error }
  }
  for (const w of validated.warnings) console.warn(`[import] ${w}`)

  return {
    ok: true,
    data: validated.data,
    warnings: validated.warnings,
    sourceVersion,
    legacy,
    upgraded: fromVersion < CURRENT_DB_VERSION,
    kind,
  }
}

/**
 * `prepareImport` over a JSON string; a parse failure is an `invalid-json`
 * result. Text over the import size cap (`MAX_IMPORT_SIZE_BYTES`, the cap the
 * file pickers and the sync file check by file size) is `too-large`, before
 * parsing. Its length in UTF-16 units never exceeds its UTF-8 size, so text
 * from a file within the cap always passes.
 */
export function prepareImportText(text: string, options: PrepareImportOptions = {}): PrepareImportResult {
  if (text.length > MAX_IMPORT_SIZE_BYTES) {
    return { ok: false, reason: 'too-large', error: `The data is too large to import (${MAX_IMPORT_SIZE_BYTES / (1024 * 1024)} MB max).` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const detail = err instanceof SyntaxError ? `: ${err.message}` : ''
    return { ok: false, reason: 'invalid-json', error: `File contains invalid JSON${detail}` }
  }
  return prepareImport(parsed, options)
}
