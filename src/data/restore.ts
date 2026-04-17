import type { Table } from 'dexie'
import { db, ensureSeededStatuses, ensureSeededListDefinitions, translateTodoV20ToV21 } from './database'
import type { ImportData } from './import-validation'
import { validateImportData } from './import-validation'

/** Type-safe table↔key pairs — eliminates implicit positional coupling (DC2) */
const TABLE_KEY_PAIRS: { table: Table; key: keyof ImportData }[] = [
  { table: db.todos, key: 'todos' },
  { table: db.projects, key: 'projects' },
  { table: db.canvases, key: 'canvases' },
  { table: db.listInsets, key: 'listInsets' },
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

/** Clear all data tables and bulk-add from validated import data, then auto-seed statuses + list definitions and translate legacy fields. */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  const tables = TABLE_KEY_PAIRS.map(p => p.table)
  await db.transaction('rw', tables, async () => {
    for (const { table } of TABLE_KEY_PAIRS) await table.clear()

    for (const { table, key } of TABLE_KEY_PAIRS) {
      const rows = v[key]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rows?.length) await (table as any).bulkAdd(rows)
    }

    // Seed missing defaults (idempotent). ensureSeededStatuses must run before
    // the v19→v20 todo walk below (statusId lookup). Order vs.
    // ensureSeededListDefinitions is a don't-care; we seed list defs first.
    await ensureSeededListDefinitions(db.listDefinitions)
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

    // v20→v21: delete priority list insets (mirrors runV21Migration).
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
