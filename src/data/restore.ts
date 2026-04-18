import type { Table } from 'dexie'
import {
  db,
  ensureSeededStatuses,
  ensureSeededListDefinitions,
  persistHorizonSlots,
  translateTodoV20ToV21,
  buildListDefFromLegacyInset,
} from './database'
import type { ImportData, ImportListInset } from './import-validation'
import { validateImportData, isLegacyMembershipKind } from './import-validation'
import type { ListDefinition } from '../models/list-definition'
import type { ListInset } from '../models'

/** Type-safe table↔key pairs — eliminates implicit positional coupling (DC2) */
const TABLE_KEY_PAIRS: { table: Table; key: keyof ImportData }[] = [
  { table: db.todos, key: 'todos' },
  { table: db.projects, key: 'projects' },
  { table: db.canvases, key: 'canvases' },
  // Note: listInsets is handled separately (post v20→v21 list-inset cleanup
  // and the v22→v23 legacy → listDefinitionId translation both run before
  // the rows land in the table).
  { table: db.people, key: 'people' },
  { table: db.settings, key: 'settings' },
  { table: db.tags, key: 'tags' },
  { table: db.todoTags, key: 'todoTags' },
  { table: db.todoPeople, key: 'todoPeople' },
  { table: db.todoOrgs, key: 'todoOrgs' },
  { table: db.personOrgs, key: 'personOrgs' },
  { table: db.orgs, key: 'orgs' },
  { table: db.savedViews, key: 'savedViews' },
  { table: db.stickyNotes, key: 'stickyNotes' },
  { table: db.taskboardEntries, key: 'taskboardEntries' },
  { table: db.statuses, key: 'statuses' },
  { table: db.listDefinitions, key: 'listDefinitions' },
]

/**
 * Rewrites the caller's `listInsets` array so every row has a `listDefinitionId`
 * pointing at a freshly-created (unpinned) `ListDefinition`. Rows with no
 * recognizable legacy shape are silently dropped. Mirrors `runV23Migration`
 * but runs after `bulkAdd` so fresh-install imports of legacy JSON converge
 * on the same state as an in-place migration.
 */
async function translateLegacyListInsets(): Promise<number> {
  const insets = await db.listInsets.toArray() as unknown as ImportListInset[]
  const existingDefs = await db.listDefinitions.toArray()
  let nextSortOrder = existingDefs.reduce((m, d) => Math.max(m, d.sortOrder), -1) + 1
  const now = new Date()

  let translated = 0
  const toDelete: number[] = []
  for (const row of insets) {
    const raw = row as unknown as Record<string, unknown>
    if (raw.listDefinitionId != null && raw.preset == null && raw.attributeFilter == null) continue
    const def = buildListDefFromLegacyInset(raw, now)
    if (!def) {
      if (row.id != null) toDelete.push(row.id)
      continue
    }
    const newId = await db.listDefinitions.add({
      ...def,
      sortOrder: nextSortOrder++,
    } as ListDefinition) as number
    await db.listInsets
      .where(':id').equals(row.id as number)
      .modify((inset) => {
        const mut = inset as unknown as Record<string, unknown>
        mut.listDefinitionId = newId
        delete mut.preset
        delete mut.attributeFilter
        delete mut.name
      })
    translated++
  }
  if (toDelete.length > 0) {
    await db.listInsets.bulkDelete(toDelete)
  }
  return translated
}

/** Clear all data tables and bulk-add from validated import data, then auto-seed statuses + list definitions and translate legacy fields. */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  const tables = TABLE_KEY_PAIRS.map(p => p.table).concat([db.listInsets])
  await db.transaction('rw', tables, async () => {
    for (const { table } of TABLE_KEY_PAIRS) await table.clear()
    await db.listInsets.clear()

    for (const { table, key } of TABLE_KEY_PAIRS) {
      const rows = v[key]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rows?.length) await (table as any).bulkAdd(rows)
    }
    // List insets: carry legacy fields through so translateLegacyListInsets can
    // read them, then strip during translation. bulkAdd accepts the extended
    // shape because Dexie doesn't validate unknown fields.
    if (v.listInsets?.length) {
      await db.listInsets.bulkAdd(v.listInsets as unknown as ListInset[])
    }

    // Drop any imported listDefinitions carrying retired v21–v23 membership
    // kinds (today / upcoming / deadlines / someday). The 5 horizon seeds
    // below replace them; user-created `custom` rows survive the import.
    const legacyDefRows = await db.listDefinitions
      .filter((d) => isLegacyMembershipKind(d.membership.kind))
      .toArray()
    if (legacyDefRows.length > 0) {
      await db.listDefinitions.bulkDelete(legacyDefRows.map((d) => d.id!))
      console.info(`Restore: dropped ${legacyDefRows.length} legacy-kind listDefinition(s)`)
    }

    // Seed missing defaults (idempotent). ensureSeededStatuses must run before
    // the v19→v20 todo walk below (statusId lookup). Order vs.
    // ensureSeededListDefinitions is a don't-care; we seed list defs first.
    const seededSlots = await ensureSeededListDefinitions(db.listDefinitions)
    if (Object.keys(seededSlots).length > 0) {
      await persistHorizonSlots(db.settings, seededSlots)
    }
    const { assignedId, followupId } = await ensureSeededStatuses(db.statuses, db.settings)

    let v20Translated = 0
    let v21Translated = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.todos.toCollection().modify((todo: any) => {
      // v19→v20
      if (todo.isStarred === true) { todo.statusId = followupId; v20Translated++ }
      else if (todo.isAssigned === true) { todo.statusId = assignedId; v20Translated++ }
      delete todo.isStarred
      delete todo.isAssigned

      // v20→v21
      const hadLegacy = todo.priority !== undefined || todo.isHardDeadline !== undefined
      translateTodoV20ToV21(todo)
      if (hadLegacy) v21Translated++
    })

    // v20→v21: delete priority list insets (mirrors runV21Migration). Must run
    // BEFORE the v22→v23 inset translation since those rows have no valid
    // translation target.
    const badPresetInsets = await db.listInsets
      .filter(li => (li as unknown as Record<string, unknown>).preset === 'high-priority')
      .toArray()
    const badAttrInsets = await db.listInsets
      .filter(li => {
        const af = (li as unknown as Record<string, unknown>).attributeFilter as Record<string, unknown> | undefined
        return af?.type === 'priority'
      })
      .toArray()
    const toDelete = [...badPresetInsets, ...badAttrInsets]
    if (toDelete.length > 0) {
      await db.listInsets.bulkDelete(toDelete.map(li => li.id!))
      console.info(`Restore: removed ${toDelete.length} priority list inset(s)`)
    }

    // v22→v23: translate legacy presets + attributeFilters into ListDefinitions.
    const v23Translated = await translateLegacyListInsets()
    if (v23Translated > 0) {
      console.info(`Restore: translated ${v23Translated} legacy list inset(s) to listDefinitionId`)
    }

    if (v20Translated > 0) {
      console.info(`Restore: translated ${v20Translated} legacy starred/assigned task(s) to seeded statuses`)
    }
    if (v21Translated > 0) {
      console.info(`Restore: translated ${v21Translated} task(s) from priority/hard-deadline to scheduled/deadline`)
    }
  })
}

/** Parse a JSON string, validate it, and restore all data tables. Returns error string on failure. */
export async function parseAndRestore(jsonString: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonString)
  } catch {
    return { ok: false, error: 'Data is corrupted (invalid JSON)' }
  }

  const result = validateImportData(parsed)
  if (!result.ok) return { ok: false, error: result.error }

  await restoreFromImportData(result.data)
  return { ok: true }
}
