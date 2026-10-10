import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from './database'
import { upgradeDataSet, type DataRow, type DataSet } from './schema-upgrades'
import { validateImportData, type ImportData } from './import-validation'
import { detectUnsupportedImport, SCHEMA_VERSION_KEY, type UnsupportedImportInfo } from '../services/migration-check'

export type PrepareImportFailure =
  | 'invalid-json'
  | 'not-object'
  | 'too-new'
  | 'upgrade-failed'
  | 'invalid'

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
    }
  | { ok: false; reason: PrepareImportFailure; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function readSchemaVersion(raw: Record<string, unknown>): number | null {
  const v = raw[SCHEMA_VERSION_KEY]
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

/**
 * The single import entry point (cr1 P2). Every path that turns an export /
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
 * Pure — no database access. Restoring is the caller's job.
 */
export function prepareImport(raw: unknown): PrepareImportResult {
  if (!isRecord(raw)) {
    return { ok: false, reason: 'not-object', error: 'Import data is not an object' }
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
  const tables: DataSet = {}
  const rest: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) tables[key] = value as DataRow[]
    else rest[key] = value
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
  const validated = validateImportData({ ...upgradedTables, ...rest })
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
  }
}

/** `prepareImport` over a JSON string; a parse failure is an `invalid-json` result. */
export function prepareImportText(text: string): PrepareImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const detail = err instanceof SyntaxError ? `: ${err.message}` : ''
    return { ok: false, reason: 'invalid-json', error: `File contains invalid JSON${detail}` }
  }
  return prepareImport(parsed)
}
