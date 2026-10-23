import { BELOW_FLOOR_BUILD, OLDEST_SUPPORTED_DB_VERSION } from './database'

/**
 * The schema-version marker every export / backup / sync file carries
 * (`buildExportData` stamps it), and the refusal `prepareImport` gives a file
 * below the floor.
 */
export const SCHEMA_VERSION_KEY = '__schemaVersion'

/**
 * Why a file below the floor (`sourceVersion`), or one without a version
 * marker (`null`), is not loaded — and how to still use it.
 */
export function tooOldFileMessage(sourceVersion: number | null, floorVersion: number = OLDEST_SUPPORTED_DB_VERSION): string {
  const saved = sourceVersion === null
    ? 'This file has no schema version: it was saved by an older version of TODO2, or is not a TODO2 file'
    : `This file was saved by an older version of TODO2 (schema v${sourceVersion})`
  return `${saved}; this version reads v${floorVersion} and newer, so nothing in it was loaded. To use it, open it in ${BELOW_FLOOR_BUILD}, export it again there, and load that file.`
}
