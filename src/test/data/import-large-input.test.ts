import { describe, it, expect } from 'vitest'
import fixture from '../fixtures/v49-export.json'
import { prepareImport, prepareImportText } from '../../data/import-pipeline'
import { MAX_IMPORT_SIZE_BYTES, MAX_RECORDS_PER_TABLE } from '../../data/import-validation'
import { upgradeV56 } from '../../data/upgrades/v56-seed-workspace-layout'

/**
 * Crafted imports must not freeze the tab before any cap applies: the
 * upgrade transforms run on the file's data before validation, so they stay
 * linear in its size, and `prepareImport` caps the table sizes before they
 * run. Each input below took 10^10 steps or more with the old quadratic
 * code (minutes); linear code finishes in about a second, so the timeouts
 * leave plenty of room on a loaded machine without letting quadratic code
 * pass.
 */

const BUDGET_MS = 30_000

/** A deep copy of the frozen v49 fixture, as a plain JSON object. */
function v49(): Record<string, unknown[]> {
  return JSON.parse(JSON.stringify(fixture)) as Record<string, unknown[]>
}

/** The fixture's first list predicate with `patch` applied (the list a test crafts). */
function withPredicate(raw: Record<string, unknown[]>, patch: Record<string, unknown>) {
  const list = raw.listDefinitions![0] as { membership: { predicate: Record<string, unknown> } }
  Object.assign(list.membership.predicate, patch)
}

const ids = (n: number, of: number) => Array.from({ length: n }, (_, i) => 1 + (i % of))

describe('import of crafted large inputs stays linear', () => {
  it('orgs → people (v55): huge org / person filter id arrays', () => {
    const raw = v49()
    const orgCount = 99_000
    raw.orgs = Array.from({ length: orgCount }, (_, i) => ({ id: i + 1, name: `Org ${i + 1}` }))
    raw.todoOrgs = []
    raw.personOrgs = []
    withPredicate(raw, { orgIds: ids(1_000_000, orgCount), personIds: ids(1_000_000, 1_000_000) })
    const result = prepareImport(raw)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
  }, BUDGET_MS)

  it('projects → tags (v60): huge project / tag filter id arrays', () => {
    const raw = v49()
    const projectCount = 99_000
    raw.projects = Array.from({ length: projectCount }, (_, i) => ({ id: i + 1, name: `Project ${i + 1}`, color: '#123456' }))
    withPredicate(raw, { projectIds: ids(1_000_000, projectCount), tags: ids(1_000_000, 1_000_000) })
    const result = prepareImport(raw)
    expect(result.ok, result.ok ? '' : result.error).toBe(true)
  }, BUDGET_MS)

  it('rails → Default layout (v56): one tab id repeated a huge number of times', () => {
    const tabs = Array.from({ length: 200_000 }, () => ({ id: 'same', type: 'notes' }))
    const rails = { left: { slots: [{ id: 'slot', tabs }] } }
    const out = upgradeV56({ settings: [{ key: 'canvasRails', value: JSON.stringify(rails) }] })
    const [layout] = out.layouts as Array<{ columns: Array<{ cells: Array<{ tabs: Array<{ id: string }> }> }> }>
    const tabIds = layout!.columns[0]!.cells[0]!.tabs.map((t) => t.id)
    expect(tabIds.slice(0, 3)).toEqual(['same', 'same-2', 'same-3'])
    expect(new Set(tabIds).size).toBe(tabIds.length)
  }, BUDGET_MS)
})

describe('import size caps apply before the upgrade', () => {
  it('a table over the record cap is refused before any transform runs (even one a transform drops)', () => {
    const raw = v49()
    // v55 drops `orgs`, so validation alone would never have seen this table.
    raw.orgs = Array.from({ length: MAX_RECORDS_PER_TABLE + 1 }, (_, i) => ({ id: i + 1, name: `Org ${i + 1}` }))
    const result = prepareImport(raw)
    expect(result).toEqual({ ok: false, reason: 'invalid', error: expect.stringContaining('"orgs" has too many records') })
  }, BUDGET_MS)

  it('a table at the record cap is accepted', () => {
    const raw = v49()
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
