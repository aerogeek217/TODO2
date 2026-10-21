import Dexie, { type Table } from 'dexie'
import { db } from './database'

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
 * Create assign/unassign operations for a join table.
 * @param table The Dexie join table (e.g., db.todoPeople)
 * @param aKey The first foreign key field name (e.g., 'todoId')
 * @param bKey The second foreign key field name (e.g., 'personId')
 */
export function createJoinOps<
  AK extends string,
  BK extends string,
  T extends JoinTableRow<AK, BK>,
>(
  table: Table<T, number>,
  aKey: AK,
  bKey: BK,
) {
  return {
    async assign(aId: number, bId: number): Promise<void> {
      await db.transaction('rw', table, async () => {
        const exists = await table
          .where(aKey).equals(aId)
          .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
          .first()
        if (!exists) {
          // Build the FK row through a typed intermediary so the assertion to T
          // is a same-shape cast, not a force-through-unknown.
          const row = { [aKey]: aId, [bKey]: bId } as Record<AK | BK, number>
          await table.add(row as T)
        }
      })
    },

    async unassign(aId: number, bId: number): Promise<void> {
      await table
        .where(aKey).equals(aId)
        .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
        .delete()
    },

    /** `assign` for each of `aIds`, in one transaction: all of them, or none. */
    async bulkAssign(aIds: readonly number[], bId: number): Promise<void> {
      if (aIds.length === 0) return
      await db.transaction('rw', table, async () => {
        const existing = await table
          .where(aKey).anyOf([...aIds])
          .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
          .toArray()
        const have = new Set(existing.map((l) => (l as Record<string, unknown>)[aKey]))
        const rows = [...new Set(aIds)].filter((aId) => !have.has(aId))
          .map((aId) => ({ [aKey]: aId, [bKey]: bId }) as Record<AK | BK, number>)
        if (rows.length > 0) await table.bulkAdd(rows as T[])
      })
    },

    /** `unassign` for each of `aIds`, in one transaction. */
    async bulkUnassign(aIds: readonly number[], bId: number): Promise<void> {
      if (aIds.length === 0) return
      await table
        .where(aKey).anyOf([...aIds])
        .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
        .delete()
    },
  }
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
 * Undo-restore for an entity delete (a person, a tag): re-insert the row
 * (keeping its id, name and every field) and the captured join rows, in one
 * transaction. A same-named entity created meanwhile (trimmed, any case — an
 * `@ann` typed after deleting Ann) is folded into the restored one instead of
 * leaving two: its join rows move to the restored id (one per task) and its
 * row goes.
 */
export async function restoreNamedEntityWithJoins<E extends { id?: number; name: string }>(
  entityTable: Table<E, number>,
  entity: E,
  link: { table: Table; entityKey: string; linkKey: string },
  joins: JoinCapture[],
): Promise<void> {
  await db.transaction('rw', [entityTable, link.table, ...joins.map((j) => j.table)], async () => {
    const target = entity.name.trim().toLowerCase()
    const meanwhile = (await entityTable.toArray())
      .filter((e) => e.id != null && e.id !== entity.id && e.name.trim().toLowerCase() === target)
    await entityTable.add(entity)
    const linked = new Set<unknown>()
    for (const { table, rows } of joins) {
      if (rows.length) await table.bulkAdd(rows)
      if (table === link.table) for (const row of rows) linked.add((row as Record<string, unknown>)[link.linkKey])
    }
    for (const other of meanwhile) {
      const rows = await link.table.where(link.entityKey).equals(other.id!).toArray() as Array<Record<string, unknown>>
      for (const row of rows) {
        const linkId = row[link.linkKey]
        if (linked.has(linkId)) await link.table.delete(row.id as number)
        else {
          await link.table.update(row.id as number, { [link.entityKey]: entity.id })
          linked.add(linkId)
        }
      }
      await entityTable.delete(other.id!)
    }
  })
}
