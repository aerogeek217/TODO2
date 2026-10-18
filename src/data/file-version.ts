import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from './database'

/**
 * The schema-version marker every export / backup / sync file carries
 * (`buildExportData` stamps it), and the "too old" check on it that
 * `prepareImport` runs.
 */
export const SCHEMA_VERSION_KEY = '__schemaVersion'

export interface UnsupportedImportInfo {
  /**
   * Source schema version, when the file embeds `__schemaVersion` (true for any
   * file written by this build of the app or later). `null` for legacy files
   * that lack the marker; in that case `descriptions` is empty and the dialog
   * falls back to "an earlier format that this build no longer supports"
   * wording — heuristic detection of pre-floor field shapes was removed once
   * the translators those signals pointed at were stripped.
   */
  sourceVersion: number | null
  targetVersion: number
  descriptions: string[]
}

/**
 * "Too old" detection only (missing marker or below the floor). Files from a
 * *newer* schema return `null` here; `data/import-pipeline.ts` `prepareImport`
 * (the single import entry point) rejects those before calling this.
 */
export function detectUnsupportedImport(raw: unknown): UnsupportedImportInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>

  // Authoritative path: file embeds its own schema version (every export
  // written after the migration-check rewrite carries `__schemaVersion`).
  // Below the floor → prompt; at-or-above → no prompt.
  const embedded = r[SCHEMA_VERSION_KEY]
  if (typeof embedded === 'number' && Number.isFinite(embedded)) {
    if (embedded >= OLDEST_SUPPORTED_DB_VERSION) return null
    return {
      sourceVersion: embedded,
      targetVersion: CURRENT_DB_VERSION,
      descriptions: [],
    }
  }

  // Marker-less file: this build's exports have always carried
  // `__schemaVersion` since the migration-check rewrite, so a missing marker
  // means the file was written by an older build. We can't tell which version
  // — could be anywhere from the original v16 schema up to v(floor-1) — so we
  // prompt with empty descriptions and the dialog explains the file is in an
  // earlier format that this build no longer supports.
  return {
    sourceVersion: null,
    targetVersion: CURRENT_DB_VERSION,
    descriptions: [],
  }
}
