import type { Table } from 'dexie'
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
 * DUP-9: Create assign/unassign operations for a join table.
 * @param table The Dexie join table (e.g., db.todoPeople)
 * @param aKey The first foreign key field name (e.g., 'todoId')
 * @param bKey The second foreign key field name (e.g., 'personId')
 */
export function createJoinOps<T>(
  table: Table<T, number>,
  aKey: keyof T & string,
  bKey: keyof T & string,
) {
  return {
    async assign(aId: number, bId: number): Promise<void> {
      await db.transaction('rw', table, async () => {
        const exists = await table
          .where(aKey).equals(aId)
          .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
          .first()
        if (!exists) {
          await table.add({ [aKey]: aId, [bKey]: bId } as unknown as T)
        }
      })
    },

    async unassign(aId: number, bId: number): Promise<void> {
      await table
        .where(aKey).equals(aId)
        .filter((l) => (l as Record<string, unknown>)[bKey] === bId)
        .delete()
    },
  }
}

/**
 * DUP-10: Build an assignment map from a join table + entity table.
 * Returns Map<linkId, Entity[]> for the given link IDs.
 * @param linkTable The join table (e.g., db.todoPeople)
 * @param entityTable The entity table (e.g., db.people)
 * @param linkIdField The field on the join table to query by (e.g., 'todoId')
 * @param entityIdField The field on the join table referencing the entity (e.g., 'personId')
 * @param linkIds The IDs to query for (e.g., todoIds)
 */
export async function buildAssignmentMap<L, E extends { id?: number }>(
  linkTable: Table<L, number>,
  entityTable: Table<E, number>,
  linkIdField: keyof L & string,
  entityIdField: keyof L & string,
  linkIds: number[],
): Promise<Map<number, E[]>> {
  if (linkIds.length === 0) return new Map()

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
