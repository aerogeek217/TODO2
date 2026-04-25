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
  buildTagRegistryFromInline,
  translateListDefinitionTagsInPlace,
  translateSavedViewTagsInPlace,
  coalesceTaskboardRows,
} from './database'
import type { ImportData, ImportListInset, ImportNote, ImportTag, ImportTodoTag } from './import-validation'
import { validateImportData, isLegacyMembershipKind } from './import-validation'
import type { ListDefinition } from '../models/list-definition'
import type { ListInset, Note, FloatingNote, Taskboard, TaskboardEntry, Tag, TodoTag, TodoItem } from '../models'

/**
 * Shape of a `todos` row read off disk during restore. Carries the current
 * TodoItem fields plus optional legacy flags written by pre-v20 / pre-v21
 * versions; the modify callback strips the legacy fields after translation.
 */
type LegacyTodoRow = TodoItem & {
  isStarred?: boolean
  isAssigned?: boolean
  priority?: number
  isHardDeadline?: boolean
}
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { savedViewToListDefinition } from './saved-view-legacy'

/**
 * Restricts to keys whose value type is an array. The bulk-add dispatch only
 * walks these keys; non-array fields (none today) wouldn't make sense.
 */
type ImportArrayKey = keyof {
  [K in keyof ImportData as Required<ImportData>[K] extends ReadonlyArray<unknown> ? K : never]: ImportData[K]
}

type RowOf<K extends keyof ImportData> =
  Required<ImportData>[K] extends ReadonlyArray<infer R> ? R : never

interface BulkAddPair {
  key: ImportArrayKey
  table: Table
  bulkAddIfPresent(data: ImportData): Promise<void>
}

/**
 * Binds a key from `ImportData` to its destination Dexie table at construction
 * time. The closure-captured `table` keeps its full generic shape so
 * `bulkAdd(rows)` typechecks without per-call-site casts (replaces the prior
 * `(table as any).bulkAdd(rows)` — code-review-2026-04-25 P10).
 */
function bulkAddPair<K extends ImportArrayKey & keyof ImportData>(
  key: K,
  table: Table<RowOf<K>>,
): BulkAddPair {
  return {
    key,
    table: table as unknown as Table,
    async bulkAddIfPresent(data: ImportData) {
      const rows = data[key] as ReadonlyArray<RowOf<K>> | undefined
      if (rows && rows.length > 0) {
        await table.bulkAdd(rows)
      }
    },
  }
}

/** Type-safe table↔key pairs — eliminates implicit positional coupling (DC2) */
const TABLE_KEY_PAIRS: BulkAddPair[] = [
  bulkAddPair('todos', db.todos),
  bulkAddPair('projects', db.projects),
  bulkAddPair('canvases', db.canvases),
  // Note: listInsets is handled separately (post v20→v21 list-inset cleanup
  // and the v22→v23 legacy → listDefinitionId translation both run before
  // the rows land in the table).
  bulkAddPair('people', db.people),
  bulkAddPair('settings', db.settings),
  bulkAddPair('todoPeople', db.todoPeople),
  bulkAddPair('todoOrgs', db.todoOrgs),
  bulkAddPair('personOrgs', db.personOrgs),
  bulkAddPair('orgs', db.orgs),
  // Pre-v39 `savedViews` rows are translated into favorited `listDefinitions`
  // via `savedViewToListDefinition`; the savedViews table no longer exists.
  // Legacy `stickyNotes` from pre-v26 backups are translated into `notes` rows
  // after the bulk-add pass below (see translateLegacyStickyNotes).
  // `taskboards` (post-v30) + legacy `taskboardEntries` (pre-v30) are handled
  // separately — see the taskboard-restore pass below.
  bulkAddPair('floatingTaskboards', db.floatingTaskboards),
  bulkAddPair('statuses', db.statuses),
  bulkAddPair('listDefinitions', db.listDefinitions),
  // `notes` is handled separately — pre-v28 rows may carry canvasId +
  // placement fields that we split into `floatingNotes` at restore time.
  bulkAddPair('floatingCalendars', db.floatingCalendars),
  bulkAddPair('floatingNotes', db.floatingNotes),
  bulkAddPair('floatingHorizons', db.floatingHorizons),
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
  // Disambiguate legacy vs current tag shapes on the backup:
  //   • pre-v29: `todoTags` join rows present but no inline `todo.tags` (the
  //     feature predated v35). Bake `#tagname` into titles via the v29 rule;
  //     do not resurrect the rows in the re-introduced tag tables.
  //   • v29–v34: neither top-level nor inline. No-op.
  //   • post-v35 inline-only: inline `todo.tags` present but no top-level
  //     arrays. Seed top-level from inline (mirrors `runV36Migration`) and
  //     translate stored predicate / saved-view `tags: string[]` → `number[]`.
  //   • post-v36: top-level arrays present (optionally with inline). Bulk-add
  //     the arrays; inline passes through transiently (v37 removes it).
  //
  // Using "todoTag joins present without inline" as the pre-v29 marker means
  // a post-v36 backup with Tag rows but no assignments is treated as post-v36
  // (its tags land in the registry), matching what the user intended.
  const hasTopLevelTags = !!(v.tags?.length || v.todoTags?.length)
  const hasTodoTagJoins = !!(v.todoTags?.length)
  // Inline `tags` was retired in v37 but legacy post-v35 backups still carry
  // it. Peek through the TodoItem type so the pass-through survives.
  const hasInlineTags = v.todos.some((t) => {
    const raw = (t as { tags?: unknown }).tags
    return Array.isArray(raw) && raw.length > 0
  })
  const isPreV29 = hasTodoTagJoins && !hasInlineTags
  const isPostV35InlineOnly = hasInlineTags && !hasTopLevelTags

  let tagsBaked = 0
  if (isPreV29) {
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

  // For post-v35 inline-only backups: build the top-level tag registry from
  // inline data so the restore converges on the same state as the in-place
  // v36 upgrade.
  if (isPostV35InlineOnly) {
    const { uniqueSlugs, joinsByTodoId } = buildTagRegistryFromInline(
      v.todos as unknown as Array<{ id?: number; tags?: unknown }>,
    )
    if (uniqueSlugs.length > 0) {
      // Assign synthetic positive ids (1..N) for the seeded tags. The bulk-add
      // below uses these as `id` overrides; Dexie accepts explicit ids on
      // ++id tables. Downstream, `todoTags` references these same ids.
      const seededTags: ImportTag[] = uniqueSlugs.map((slug, i) => ({
        id: i + 1,
        name: slug,
        color: DEFAULT_ENTITY_COLOR,
      }))
      const slugToId = new Map<string, number>()
      for (const t of seededTags) slugToId.set(t.name, t.id!)
      const seededJoins: ImportTodoTag[] = []
      let joinId = 1
      for (const [todoId, slugs] of joinsByTodoId) {
        for (const slug of slugs) {
          const tagId = slugToId.get(slug)
          if (tagId != null) seededJoins.push({ id: joinId++, todoId, tagId })
        }
      }
      v.tags = seededTags
      v.todoTags = seededJoins

      const unknownCollector = new Set<string>()
      for (const def of v.listDefinitions ?? []) {
        translateListDefinitionTagsInPlace(
          def as unknown as Record<string, unknown>,
          slugToId,
          unknownCollector,
        )
      }
      for (const sv of v.savedViews ?? []) {
        translateSavedViewTagsInPlace(
          sv as unknown as Record<string, unknown>,
          slugToId,
          unknownCollector,
        )
      }
      if (unknownCollector.size > 0) {
        console.warn(
          `Restore: dropped ${unknownCollector.size} unknown tag name(s) from stored predicates: ${[...unknownCollector].join(', ')}`,
        )
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
    // Only neutralize the pre-v29 'tag' enum value on legacy backups. Post-v35
    // backups legitimately carry `groupBy: 'tag'` for the re-introduced feature.
    if (isPreV29) {
      if (svRow.sortBy === 'tag') svRow.sortBy = 'date'
      if (svRow.groupBy === 'tag') svRow.groupBy = 'none'
    }
  }

  // Strip the retired inline `tags` key from every todo before bulk-add so
  // restored state matches the post-v37 shape (registry is the sole source of
  // truth). Any translation that needed inline data has already run above.
  for (const t of v.todos) {
    delete (t as { tags?: unknown }).tags
  }

  const tables = TABLE_KEY_PAIRS.map(p => p.table).concat([db.listInsets, db.notes, db.taskboards, db.tags, db.todoTags])
  await db.transaction('rw', tables, async () => {
    for (const p of TABLE_KEY_PAIRS) await p.table.clear()
    await db.listInsets.clear()
    await db.notes.clear()
    await db.taskboards.clear()
    await db.tags.clear()
    await db.todoTags.clear()

    for (const p of TABLE_KEY_PAIRS) {
      await p.bulkAddIfPresent(v)
    }

    // Post-v36 backups carry `tags` + `todoTags` top-level arrays that belong
    // in the re-introduced tables. Pre-v29 backups also carry these arrays but
    // restore has already baked their names into titles and intentionally
    // does not resurrect the tag rows (plan tags-v2 P1 / runV29Migration).
    if (!isPreV29) {
      if (v.tags?.length) await db.tags.bulkAdd(v.tags as Tag[])
      if (v.todoTags?.length) await db.todoTags.bulkAdd(v.todoTags as TodoTag[])
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

    // Taskboards: collapse whatever the import carries (post-v30 multi-row
    // table, pre-v30 `taskboardEntries` queue, or nothing) into a single
    // singleton row. Strip `name` + `taskboardId` along the way.
    const importedTaskboardRows = (v.taskboards ?? []).map((t) => ({
      id: t.id,
      entries: t.entries as TaskboardEntry[],
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
    const legacyEntriesRow = (!importedTaskboardRows.length && v.taskboardEntries?.length)
      ? [{ id: 1, entries: v.taskboardEntries as TaskboardEntry[], createdAt: new Date(), updatedAt: new Date() }]
      : []
    const { survivor } = coalesceTaskboardRows(
      importedTaskboardRows.length ? importedTaskboardRows : legacyEntriesRow,
    )
    await db.taskboards.add({
      entries: survivor.entries,
      createdAt: survivor.createdAt,
      updatedAt: survivor.updatedAt,
    } as Taskboard)
    // v33 strips the legacy `defaultTaskboardId` setting — never re-persist it.
    await db.settings.delete('defaultTaskboardId')
    // code-review-2026-04-25 P8 retires the dormant Dashboard-era settings
    // surface (`dashboardUserLists` / `notesPinnedToDashboard` + the older
    // `notesDock` / `notesVisible` rows). Older backups still validate
    // (legacy keys remain in `VALID_SETTING_KEYS`), but their values are
    // stripped from IndexedDB on restore so they don't accumulate.
    await db.settings.bulkDelete([
      'dashboardUserLists',
      'notesPinnedToDashboard',
      'notesDock',
      'notesVisible',
    ])

    // Drop `taskboardId` from every imported floating-taskboard row (silently
    // stripped by the validator's picker, but belt-and-suspenders here).
    await db.floatingTaskboards.toCollection().modify((row) => {
      const r = row as unknown as Record<string, unknown>
      if ('taskboardId' in r) delete r.taskboardId
    })

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
    await db.todos.toCollection().modify((todo) => {
      const legacy = todo as LegacyTodoRow
      // v19→v20
      if (legacy.isStarred === true) { legacy.statusId = followupId; v20Translated++ }
      else if (legacy.isAssigned === true) { legacy.statusId = assignedId; v20Translated++ }
      delete legacy.isStarred
      delete legacy.isAssigned

      // v20→v21
      const hadLegacy = legacy.priority !== undefined || legacy.isHardDeadline !== undefined
      translateTodoV20ToV21(legacy as unknown as Record<string, unknown>)
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

    // v39: backfill `favorited: false` on every imported list-def so the
    // post-restore shape matches what in-place v39 produces.
    await db.listDefinitions.toCollection().modify((def) => {
      const r = def as unknown as Record<string, unknown>
      if (r.favorited === undefined) r.favorited = false
    })

    // v39: fold pre-v39 saved-view rows into favorited listDefinitions.
    if (v.savedViews?.length) {
      const allStatuses = await db.statuses.toArray()
      const existing = await db.listDefinitions.toArray()
      let nextSortOrder = existing.reduce((m, d) => Math.max(m, d.sortOrder), -1) + 1
      for (const sv of v.savedViews) {
        const base = savedViewToListDefinition(sv, assignedId, followupId, allStatuses)
        await db.listDefinitions.add({
          ...base,
          sortOrder: nextSortOrder++,
        } as ListDefinition)
      }
      console.info(`Restore: translated ${v.savedViews.length} savedView(s) into favorited listDefinition(s)`)
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
