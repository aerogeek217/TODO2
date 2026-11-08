import Dexie, { type Table } from 'dexie'
import { db } from './database'
import { touchTodoIds, type TaskTouch } from './touch-todos'
import { logAssignmentEvents, type AssignmentEventType } from './todo-event-repository'

/**
 * One row of join-table data to be captured pre-delete and restored on undo.
 * Carries its `Table` ref so a single transaction can span the entity table
 * plus every join table the entity touches.
 */
export interface JoinCapture { table: Table; rows: unknown[] }

/**
 * Capture every row in the listed join tables that references the given id —
 * used by `*Store.remove` before deleting the entity, so undo can restore the
 * exact join membership that existed at delete time.
 */
export async function captureJoinRows(
  captures: Array<{ table: Table; key: string; id: number }>,
): Promise<JoinCapture[]> {
  return Promise.all(
    captures.map(async ({ table, key, id }) => ({
      table,
      rows: await table.where(key).equals(id).toArray(),
    })),
  )
}

/**
 * Shape every join-table row in this codebase shares: an optional auto-id plus
 * two number FKs. Used as the constraint for `createJoinOps` so the row builder
 * can type-check without passing through `unknown`.
 */
type JoinTableRow<AK extends string, BK extends string> =
  & Record<AK | BK, number>
  & { id?: number }

/**
 * Create assign/unassign operations for a join table whose first key is a
 * task's (`todoPeople`, `todoTags`). An assignment is activity on its task:
 * given a `touch`, each write stamps the `modifiedAt` of the tasks whose rows
 * it changed (none when the row was already there / already gone), in its
 * own transaction, and records what it stamped (`touch-todos`). Each row it
 * adds or deletes is logged as an `eventType` add / remove in the same
 * transaction (`todoEvents`, the history log H3) — an undo or redo too,
 * which runs these again.
 * @param table The Dexie join table (e.g., db.todoPeople)
 * @param aKey The task's foreign key field name ('todoId')
 * @param bKey The second foreign key field name (e.g., 'personId')
 * @param eventType The event a row change logs ('person' / 'tag')
 */
export function createJoinOps<
  AK extends string,
  BK extends string,
  T extends JoinTableRow<AK, BK>,
>(
  table: Table<T, number>,
  aKey: AK,
  bKey: BK,
  eventType: AssignmentEventType,
) {
  const ops = {
    async assign(aId: number, bId: number, touch?: TaskTouch): Promise<void> {
      await ops.bulkAssign([aId], bId, touch)
    },

    async unassign(aId: number, bId: number, touch?: TaskTouch): Promise<void> {
      await ops.bulkUnassign([aId], bId, touch)
    },

    /** `assign` for each of `aIds`, in one transaction: all of them, or none. */
    async bulkAssign(aIds: readonly number[], bId: number, touch?: TaskTouch): Promise<void> {
      if (aIds.length === 0) return
      await db.transaction('rw', [table, db.todos, db.todoEvents], async () => {
        const existing = await table
          .where(aKey).anyOf([...aIds])
          .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
          .toArray()
        const have = new Set(existing.map((l) => (l as Record<string, unknown>)[aKey]))
        const added = [...new Set(aIds)].filter((aId) => !have.has(aId))
        // Build the FK rows through a typed intermediary so the assertion to T
        // is a same-shape cast, not a force-through-unknown.
        const rows = added.map((aId) => ({ [aKey]: aId, [bKey]: bId }) as Record<AK | BK, number>)
        if (rows.length > 0) await table.bulkAdd(rows as T[])
        await logAssignmentEvents(eventType, added.map((aId) => ({ todoId: aId, id: bId })), 'add')
        await touchTodoIds(added, touch)
      })
    },

    /** `unassign` for each of `aIds`, in one transaction. */
    async bulkUnassign(aIds: readonly number[], bId: number, touch?: TaskTouch): Promise<void> {
      if (aIds.length === 0) return
      await db.transaction('rw', [table, db.todos, db.todoEvents], async () => {
        const rows = await table
          .where(aKey).anyOf([...aIds])
          .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
          .toArray()
        if (rows.length === 0) return
        await table.bulkDelete(rows.map((l) => (l as Record<string, unknown>).id as number))
        await logAssignmentEvents(eventType, rows.map((l) => ({ todoId: (l as Record<string, unknown>)[aKey] as number, id: bId })), 'remove')
        await touchTodoIds(rows.map((l) => (l as Record<string, unknown>)[aKey] as number), touch)
      })
    },
  }
  return ops
}

/**
 * Build an assignment map from a join table + entity table.
 * Returns Map<linkId, Entity[]> for the given link IDs.
 * @param linkTable The join table (e.g., db.todoPeople)
 * @param entityTable The entity table (e.g., db.people)
 * @param linkIdField The field on the join table to query by (e.g., 'todoId')
 * @param entityIdField The field on the join table referencing the entity (e.g., 'personId')
 * @param linkIds The IDs to query for (e.g., todoIds)
 *
 * A snapshot read for the UI, always outside any open transaction
 * (`Dexie.ignoreTransaction`): store writes inside a transaction re-render React
 * synchronously, so effects that load assignments can start in that
 * transaction's zone, whose scope doesn't cover these tables.
 */
export async function buildAssignmentMap<L, E extends { id?: number }>(
  linkTable: Table<L, number>,
  entityTable: Table<E, number>,
  linkIdField: keyof L & string,
  entityIdField: keyof L & string,
  linkIds: number[],
): Promise<Map<number, E[]>> {
  if (linkIds.length === 0) return new Map()
  return Dexie.ignoreTransaction(() => readAssignmentMap(linkTable, entityTable, linkIdField, entityIdField, linkIds))
}

async function readAssignmentMap<L, E extends { id?: number }>(
  linkTable: Table<L, number>,
  entityTable: Table<E, number>,
  linkIdField: keyof L & string,
  entityIdField: keyof L & string,
  linkIds: number[],
): Promise<Map<number, E[]>> {
  const links = await linkTable.where(linkIdField).anyOf(linkIds).toArray()
  const entityIds = [...new Set(links.map((l) => (l as Record<string, unknown>)[entityIdField] as number))]
  const entities = entityIds.length > 0
    ? await entityTable.where('id').anyOf(entityIds).toArray()
    : []

  const entityMap = new Map<number, E>()
  for (const e of entities) entityMap.set(e.id!, e)

  const result = new Map<number, E[]>()
  for (const link of links) {
    const entityId = (link as Record<string, unknown>)[entityIdField] as number
    const linkId = (link as Record<string, unknown>)[linkIdField] as number
    const entity = entityMap.get(entityId)
    if (entity) {
      const list = result.get(linkId) ?? []
      list.push(entity)
      result.set(linkId, list)
    }
  }
  return result
}

/**
 * The task join table of a person or tag: the table, its entity's key, its
 * task's key, and the event a row change logs (`todoEvents`, H3).
 */
export interface EntityLink {
  table: Table
  entityKey: string
  linkKey: string
  event: AssignmentEventType
}

/** The task assignments an entity's delete takes, logged as removes (in the caller's transaction, which holds `todos` and `todoEvents`). */
export async function logEntityJoinsRemoved(link: EntityLink, rows: readonly unknown[]): Promise<void> {
  await logAssignmentEvents(link.event, rows.map((r) => {
    const row = r as Record<string, unknown>
    return { todoId: row[link.linkKey] as number, id: row[link.entityKey] as number }
  }), 'remove')
}

/**
 * Undo-restore for an entity delete (a person, a tag): re-insert the row
 * (keeping its id, name and every field) and the captured join rows, in one
 * transaction. A same-named entity created meanwhile (trimmed, any case — an
 * `@ann` typed after deleting Ann) is folded into the restored one instead of
 * leaving two: its join rows move to the restored id (one per task) and its
 * row goes. Each assignment that comes back or moves is logged (`link.event`:
 * an add of the restored id, a remove of the folded one's).
 */
export async function restoreNamedEntityWithJoins<E extends { id?: number; name: string }>(
  entityTable: Table<E, number>,
  entity: E,
  link: EntityLink,
  joins: JoinCapture[],
): Promise<void> {
  await db.transaction('rw', [entityTable, link.table, db.todos, db.todoEvents, ...joins.map((j) => j.table)], async () => {
    const target = entity.name.trim().toLowerCase()
    const meanwhile = (await entityTable.toArray())
      .filter((e) => e.id != null && e.id !== entity.id && e.name.trim().toLowerCase() === target)
    await entityTable.add(entity)
    const linked = new Set<unknown>()
    const added: { todoId: number; id: number }[] = []
    const removed: { todoId: number; id: number }[] = []
    for (const { table, rows } of joins) {
      if (rows.length) await table.bulkAdd(rows)
      if (table !== link.table) continue
      for (const row of rows) {
        const linkId = (row as Record<string, unknown>)[link.linkKey]
        linked.add(linkId)
        added.push({ todoId: linkId as number, id: entity.id! })
      }
    }
    for (const other of meanwhile) {
      const rows = await link.table.where(link.entityKey).equals(other.id!).toArray() as Array<Record<string, unknown>>
      for (const row of rows) {
        const linkId = row[link.linkKey]
        removed.push({ todoId: linkId as number, id: other.id! })
        if (linked.has(linkId)) await link.table.delete(row.id as number)
        else {
          await link.table.update(row.id as number, { [link.entityKey]: entity.id })
          linked.add(linkId)
          added.push({ todoId: linkId as number, id: entity.id! })
        }
      }
      await entityTable.delete(other.id!)
    }
    await logAssignmentEvents(link.event, removed, 'remove')
    await logAssignmentEvents(link.event, added, 'add')
  })
}
