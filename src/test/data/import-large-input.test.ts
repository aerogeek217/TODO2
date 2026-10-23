import { describe, it, expect } from 'vitest'
import fixture from '../fixtures/v68-export.json'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { MAX_IMPORT_SIZE_BYTES, MAX_RECORDS_PER_TABLE } from '../../data/import-validation'

/**
 * Crafted imports must not freeze the tab before any cap applies:
 * `prepareImportText` refuses text over the size cap before parsing it, and
 * `prepareImport` caps the table sizes before any upgrade transform runs on
 * the file's data (validation only checks them after).
 */

const BUDGET_MS = 30_000

/** A deep copy of the frozen v68 fixture, as a plain JSON object. */
function v68(): Record<string, unknown[]> {
  return JSON.parse(JSON.stringify(fixture)) as Record<string, unknown[]>
}

describe('import size caps apply before the upgrade', () => {
  it('a table over the record cap is refused before any transform runs (even one validation never sees)', () => {
    const raw = v68()
    // No table of this build: validation alone would never have seen it.
    raw.retiredTable = Array.from({ length: MAX_RECORDS_PER_TABLE + 1 }, (_, i) => ({ id: i + 1 }))
    const result = prepareImport(raw)
    expect(result).toEqual({ ok: false, reason: 'invalid', error: expect.stringContaining('"retiredTable" has too many records') })
  }, BUDGET_MS)

  it('a table at the record cap is accepted', () => {
    const raw = v68()
    raw.todoEvents = Array.from({ length: MAX_RECORDS_PER_TABLE }, (_, i) => ({
      id: i + 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: '2026-01-01T00:00:00.000Z',
    }))
    const result = prepareImport(raw)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
  }, BUDGET_MS)

  it('text over the size cap is refused before it is parsed', () => {
    const text = ' '.repeat(MAX_IMPORT_SIZE_BYTES + 1)
    expect(prepareImportText(text)).toEqual({ ok: false, reason: 'too-large', error: expect.stringContaining('50 MB') })
  })

  it('text at the size cap is parsed as usual', () => {
    const json = JSON.stringify(fixture)
    const text = json + ' '.repeat(MAX_IMPORT_SIZE_BYTES - json.length)
    expect(text.length).toBe(MAX_IMPORT_SIZE_BYTES)
    expect(prepareImportText(text).ok).toBe(true)
  })
})
