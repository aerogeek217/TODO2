import { describe, it, expect } from 'vitest'
import type { PersistedTodoItem, Person, Tag } from '../../models'
import { bucketByMany } from '../../utils/bucket-by-many'

function makeTodo(id: number): PersistedTodoItem {
  return {
    id,
    title: `Task ${id}`,
    isCompleted: false,
    sortOrder: id,
    createdAt: new Date(),
    modifiedAt: new Date(),
  } as PersistedTodoItem
}

describe('bucketByMany', () => {
  it('places a single-assignee todo in one bucket', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const t = makeTodo(10)
    const assigned = new Map<number, Person[]>([[10, [alice]]])
    const { buckets, unassigned } = bucketByMany([t], [alice, bob], assigned)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].entity.id).toBe(1)
    expect(buckets[0].todos.map((x) => x.id)).toEqual([10])
    expect(unassigned).toEqual([])
  })

  it('puts multi-assignee todos in every assigned bucket', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const t = makeTodo(10)
    const assigned = new Map<number, Person[]>([[10, [alice, bob]]])
    const { buckets } = bucketByMany([t], [alice, bob], assigned)
    expect(buckets).toHaveLength(2)
    expect(buckets[0].todos.map((x) => x.id)).toEqual([10])
    expect(buckets[1].todos.map((x) => x.id)).toEqual([10])
  })

  it('emits buckets in the entity-list order', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const bob: Person = { id: 2, name: 'Bob', initials: 'B' }
    const carol: Person = { id: 3, name: 'Carol', initials: 'C' }
    const t = makeTodo(10)
    const assigned = new Map<number, Person[]>([[10, [carol, alice, bob]]])
    const { buckets } = bucketByMany([t], [alice, bob, carol], assigned)
    expect(buckets.map((b) => b.entity.id)).toEqual([1, 2, 3])
  })

  it('honors compare override (alphabetical by tag name)', () => {
    const t1: Tag = { id: 1, name: 'zeta', color: '#000' }
    const t2: Tag = { id: 2, name: 'alpha', color: '#000' }
    const todo = makeTodo(10)
    const assigned = new Map<number, Tag[]>([[10, [t1, t2]]])
    const { buckets } = bucketByMany([todo], [t1, t2], assigned, {
      compare: (a, b) => a.name.localeCompare(b.name),
    })
    expect(buckets.map((b) => b.entity.name)).toEqual(['alpha', 'zeta'])
  })

  it('routes todos with no assignment to unassigned', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const t = makeTodo(10)
    const assigned = new Map<number, Person[]>()
    const { buckets, unassigned } = bucketByMany([t], [alice], assigned)
    expect(buckets).toHaveLength(0)
    expect(unassigned.map((x) => x.id)).toEqual([10])
  })

  it('treats orphan-id assignments (entity removed since) as unassigned', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const ghost: Person = { id: 99, name: 'Ghost', initials: 'G' }
    const t = makeTodo(10)
    const assigned = new Map<number, Person[]>([[10, [ghost]]])
    const { buckets, unassigned } = bucketByMany([t], [alice], assigned)
    expect(buckets).toHaveLength(0)
    expect(unassigned.map((x) => x.id)).toEqual([10])
  })

  it('dedups duplicate ids on a single todo', () => {
    const alice: Person = { id: 1, name: 'Alice', initials: 'A' }
    const t = makeTodo(10)
    const assigned = new Map<number, Person[]>([[10, [alice, alice]]])
    const { buckets } = bucketByMany([t], [alice], assigned)
    expect(buckets).toHaveLength(1)
    expect(buckets[0].todos).toHaveLength(1)
  })
})
