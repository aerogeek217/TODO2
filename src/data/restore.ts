import type { Table } from 'dexie'
import {
  db,
  ensureSeededStatuses,
  ensureSeededListDefinitions,
  persistHorizonSlots,
  translateTodoV20ToV21,
  translateStickyToNote,
  translateNoteToFloatingNote,
  buildListDefFromLegacyInset,
  appendTagNamesToTitle,
  buildTagNamesByTodo,
} from './database'
import type { ImportData, ImportListInset, ImportNote } from './import-validation'
import { validateImportData, isLegacyMembershipKind } from './import-validation'
import type { ListDefinition } from '../models/list-definition'
import type { ListInset, Note, FloatingNote } from '../models'

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
  { table: db.todoPeople, key: 'todoPeople' },
  { table: db.todoOrgs, key: 'todoOrgs' },
  { table: db.personOrgs, key: 'personOrgs' },
  { table: db.orgs, key: 'orgs' },
  { table: db.savedViews, key: 'savedViews' },
  // Legacy `stickyNotes` from pre-v26 backups are translated into `notes` rows
  // after the bulk-add pass below (see translateLegacyStickyNotes).
  { table: db.taskboardEntries, key: 'taskboardEntries' },
  { table: db.statuses, key: 'statuses' },
  { table: db.listDefinitions, key: 'listDefinitions' },
  // `notes` is handled separately — pre-v28 rows may carry canvasId +
  // placement fields that we split into `floatingNotes` at restore time.
  { table: db.floatingCalendars, key: 'floatingCalendars' },
  { table: db.floatingNotes, key: 'floatingNotes' },
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

/**
 * Split imported `notes` rows into two buckets:
 *   • Global (canvasId == null): cleaned up to the post-v28 content-only
 *     shape and written to `notes`.
 *   • Canvas-scoped (canvasId != null): translated to placement-only rows
 *     (content + color dropped) and written to `floatingNotes`. Matches the
 *     in-place v28 migration in `runV28Migration`.
 */
async function restoreNoteBuckets(importNotes: ImportNote[]): Promise<{ global: number; floating: number }> {
  if (!importNotes.length) return { global: 0, floating: 0 }
  const globals: Note[] = []
  const floatings: Omit<FloatingNote, 'id'>[] = []
  for (const row of importNotes) {
    if (row.canvasId != null) {
      const placement = translateNoteToFloatingNote(row as unknown as Record<string, unknown>)
      if (placement) floatings.push(placement)
      continue
    }
    globals.push({
      ...(row.id != null ? { id: row.id } : {}),
      content: row.content,
      createdAt: row.createdAt,
      modifiedAt: row.modifiedAt,
    })
  }
  if (globals.length > 0) await db.notes.bulkAdd(globals as Note[])
  if (floatings.length > 0) await db.floatingNotes.bulkAdd(floatings as FloatingNote[])
  return { global: globals.length, floating: floatings.length }
}

/** Clear all data tables and bulk-add from validated import data, then auto-seed statuses + list definitions and translate legacy fields. */
export async function restoreFromImportData(v: ImportData): Promise<void> {
  // Pre-v29 backups carry `tags` + `todoTags` arrays. Bake the tag names into
  // todo titles (` #tagname`) before the bulk-add so the surviving DB has no
  // tag-feature footprint. Mirrors the in-place `runV29Migration`.
  let tagsBaked = 0
  if (v.tags?.length || v.todoTags?.length) {
    const namesByTodo = buildTagNamesByTodo(v.todoTags ?? [], v.tags ?? [])
    if (namesByTodo.size > 0) {
      for (const todo of v.todos) {
        if (todo.id == null) continue
        const names = namesByTodo.get(todo.id)
        if (!names || names.length === 0) continue
        todo.title = appendTagNamesToTitle(todo.title, names)
        tagsBaked++
      }
    }
  }

  // Strip tagIds from any custom predicate carried in saved list defs / views
  // (post-v29 the field is gone from the runtime shape).
  for (const def of v.listDefinitions ?? []) {
    const m = def.membership as Record<string, unknown> | undefined
    if (!m || m.kind !== 'custom') continue
    const p = m.predicate as Record<string, unknown> | undefined
    if (p && 'tagIds' in p) delete p.tagIds
  }
  for (const sv of v.savedViews ?? []) {
    const svRow = sv as unknown as Record<string, unknown>
    const f = svRow.filters as Record<string, unknown> | undefined
    if (f && 'tagIds' in f) delete f.tagIds
    if (svRow.sortBy === 'tag') svRow.sortBy = 'date'
    if (svRow.groupBy === 'tag') svRow.groupBy = 'none'
  }

  const tables = TABLE_KEY_PAIRS.map(p => p.table).concat([db.listInsets, db.notes])
  await db.transaction('rw', tables, async () => {
    for (const { table } of TABLE_KEY_PAIRS) await table.clear()
    await db.listInsets.clear()
    await db.notes.clear()

    for (const { table, key } of TABLE_KEY_PAIRS) {
      const rows = v[key]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (rows?.length) await (table as any).bulkAdd(rows)
    }

    if (tagsBaked > 0) {
      console.info(`Restore: baked tag names into ${tagsBaked} todo title(s) (tags feature retired in v29)`)
    }

    // Split `notes` into global vs floating at restore time (matches v28).
    const noteBuckets = await restoreNoteBuckets(v.notes)
    if (noteBuckets.floating > 0) {
      console.info(`Restore: split ${noteBuckets.floating} canvas-scoped note(s) into floatingNotes`)
    }

    // Pre-v26 backups carry a `stickyNotes` array. Each row becomes a
    // placement-only `floatingNotes` row — content + color are dropped to
    // match the post-v28 contract. (We no longer merge sticky text into the
    // global note; pre-v28 import tests that expected that will need updates.)
    if (v.stickyNotes?.length) {
      // translateStickyToNote is still used to normalize the shape (canvasId,
      // x/y/w/h) before handing to the floating-note translator.
      const sticky = v.stickyNotes.map((s) =>
        translateStickyToNote(s as unknown as Record<string, unknown>),
      )
      const placements: Omit<FloatingNote, 'id'>[] = []
      for (const s of sticky) {
        const placement = translateNoteToFloatingNote(s as unknown as Record<string, unknown>)
        if (placement) placements.push(placement)
      }
      if (placements.length > 0) {
        await db.floatingNotes.bulkAdd(placements as FloatingNote[])
        console.info(`Restore: translated ${placements.length} legacy sticky-note(s) to floating notes (content dropped)`)
      }
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
