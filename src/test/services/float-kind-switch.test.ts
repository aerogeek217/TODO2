import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { convertFloatingKind } from '../../services/float-kind-switch'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { resetFloatingStores } from '../helpers'
import {
  FLOAT_KIND_PAIRS,
  seedFloat,
  getFloatRows,
} from '../utils/kind-switch-table'

const RECT = { x: 100, y: 200, width: 480, height: 320 }
const CANVAS_ID = 1

beforeEach(async () => {
  await db.delete()
  await db.open()
  resetFloatingStores()
  useListDefinitionStore.setState({ listDefinitions: [] })
})

describe('convertFloatingKind — kind-pair matrix', () => {
  it.each(FLOAT_KIND_PAIRS)('$from → $to preserves rect (or no-ops when same)', async ({ from, to }) => {
    const sourceId = await seedFloat(from, CANVAS_ID, RECT.x, RECT.y)
    const result = await convertFloatingKind({
      sourceKind: from,
      sourceId,
      canvasId: CANVAS_ID,
      rect: RECT,
      nextKind: to,
    })

    if (from === to) {
      // Same-kind switches are a no-op: returns source id, source row stays.
      expect(result).toBe(sourceId)
      expect(getFloatRows(from).map((r) => r.id)).toEqual([sourceId])
      return
    }

    expect(result).not.toBeNull()
    // Source row gone.
    expect(getFloatRows(from)).toHaveLength(0)
    // Target row created at the source rect.
    const created = getFloatRows(to).find((r) => r.id === result)
    expect(created).toBeDefined()
    expect(created).toMatchObject({
      x: RECT.x,
      y: RECT.y,
      width: RECT.width,
      height: RECT.height,
    })
  })
})
