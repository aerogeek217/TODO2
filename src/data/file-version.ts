import { BELOW_FLOOR_BUILD, OLDEST_SUPPORTED_DB_VERSION } from './database'

/**
 * The schema-version marker every export / backup / sync file carries
 * (`buildExportData` stamps it), and the refusal `prepareImport` gives a file
 * below the floor.
 */
export const SCHEMA_VERSION_KEY = '__schemaVersion'

/**
 * Why a file below the floor (`sourceVersion`), or one without a valid
 * version marker (`null` — none, or not a whole number), is not loaded — and
 * how to still use it.
 */
export function tooOldFileMessage(sourceVersion: number | null, floorVersion: number = OLDEST_SUPPORTED_DB_VERSION): string {
  if (sourceVersion === null) {
    return `This file has no valid schema version: it was saved by an older version of TODO2, or is not a TODO2 file; this version reads v${floorVersion} and newer, so nothing in it was loaded. If it is a TODO2 file, open it in ${BELOW_FLOOR_BUILD}, export it again there, and load that file.`
  }
  return `This file was saved by an older version of TODO2 (schema v${sourceVersion}); this version reads v${floorVersion} and newer, so nothing in it was loaded. To use it, open it in ${BELOW_FLOOR_BUILD}, export it again there, and load that file.`
}
