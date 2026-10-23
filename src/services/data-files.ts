import { buildExportData, selfCheckExportJson } from '../data/export-data'
import { prepareImportText, type PrepareImportOptions, type PrepareImportResult } from '../data/import-pipeline'
import { MAX_IMPORT_SIZE_BYTES } from '../data/import-validation'

/**
 * The JSON data files the user exports and imports (Settings → Import /
 * Export), over the data layer's export builder and import pipeline.
 */

/** A full export as the file's text (`exportedAt` = `now`). */
export async function buildJsonExport(now: Date = new Date()): Promise<string> {
  const tables = await buildExportData()
  return JSON.stringify({ ...tables, exportedAt: now.toISOString() }, null, 2)
}

/** Why an export's text would not import back, or `null` when it would. */
export function exportImportProblem(json: string): string | null {
  return selfCheckExportJson(json)
}

/** A file timestamp: `2026-10-16_12-30-00-000`. */
export function exportFileTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

/** An import file read and prepared, or `too-large` (over the import cap) before reading it. */
export async function readImportFile(file: File, options?: PrepareImportOptions): Promise<PrepareImportResult | { ok: false; reason: 'file-too-large' }> {
  if (file.size > MAX_IMPORT_SIZE_BYTES) return { ok: false, reason: 'file-too-large' }
  return prepareImportText(await file.text(), options)
}
