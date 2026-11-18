import { describe, expect, it } from 'vitest'
import { buildClusterGraph, layoutClusters } from '../../utils/work-clusters'

const TODAY = new Date(2026, 10, 18, 10)
const day = (offset: number) => new Date(2026, 10, 18 + offset, 9)

type Named = { id: number; name: string }
const person = (id: number, name: string): Named => ({ id, name })
const tag = (id: number, name: string): Named => ({ id, name })

const ANA = person(1, 'Ana')
const BEN = person(2, 'Ben')
const CY = person(3, 'Cy')
const DEE = person(4, 'Dee')
const ATLAS = tag(11, 'Atlas')
const OPS = tag(12, 'Ops')
const HIRING = tag(13, 'Hiring')

interface Spec { id: number; people: Named[]; tags: Named[]; due?: Date; done?: boolean }

function graphOf(specs: Spec[]) {
  const people = new Map(specs.map((s) => [s.id, s.people]))
  const tags = new Map(specs.map((s) => [s.id, s.tags]))
  return buildClusterGraph({
    todos: specs.map((s) => ({ id: s.id, isCompleted: s.done === true, ...(s.due ? { dueDate: s.due } : {}) })),
    peopleOf: (id) => people.get(id),
    tagsOf: (id) => tags.get(id),
    today: TODAY,
  })
}

/** Two teams: Ana and Ben on Atlas (and a little Ops), Cy and Dee on Hiring; Ben once on Hiring. */
const TWO_TEAMS: Spec[] = [
  { id: 1, people: [ANA], tags: [ATLAS], due: day(-2) },
  { id: 2, people: [ANA, BEN], tags: [ATLAS] },
  { id: 3, people: [BEN], tags: [ATLAS, OPS] },
  { id: 4, people: [ANA], tags: [ATLAS] },
  { id: 5, people: [CY], tags: [HIRING], due: day(-1) },
  { id: 6, people: [CY, DEE], tags: [HIRING] },
  { id: 7, people: [DEE], tags: [HIRING] },
  { id: 8, people: [BEN], tags: [HIRING] },
  { id: 9, people: [ANA], tags: [ATLAS], done: true },
]

describe('Work clusters (task maps B2)', () => {
  it('counts each person’s and tag’s open tasks and the tasks each pair shares', () => {
    const g = graphOf(TWO_TEAMS)
    const count = Object.fromEntries(g.nodes.map((n) => [n.name, [n.count, n.overdue]]))
    expect(count).toEqual({ Ana: [3, 1], Ben: [3, 0], Atlas: [4, 1], Hiring: [4, 1], Cy: [2, 1], Dee: [2, 0], Ops: [1, 0] })
    const link = (a: string, b: string) => g.links.find((l) => g.nodes[l.a]!.name === a && g.nodes[l.b]!.name === b)?.weight
    expect(link('Ana', 'Atlas')).toBe(3)
    expect(link('Ben', 'Atlas')).toBe(2)
    expect(link('Ben', 'Hiring')).toBe(1)
    expect(link('Ana', 'Hiring')).toBeUndefined()
    expect(g.hidden).toBe(0)
  })

  it('finds the two teams as clusters, each named by its biggest tag, the bridge between them marked', () => {
    const g = graphOf(TWO_TEAMS)
    const members = g.clusters.map((c) => ({ name: c.name, nodes: c.nodes.map((i) => g.nodes[i]!.name).sort(), tasks: c.todoIds.length, overdue: c.overdue }))
    expect(members).toEqual([
      { name: 'Atlas', nodes: ['Ana', 'Atlas', 'Ben', 'Ops'], tasks: 5, overdue: 1 },
      { name: 'Hiring', nodes: ['Cy', 'Dee', 'Hiring'], tasks: 4, overdue: 1 },
    ])
    const bridges = g.links.filter((l) => l.bridge).map((l) => [g.nodes[l.a]!.name, g.nodes[l.b]!.name])
    expect(bridges).toEqual([['Ben', 'Hiring']])
  })

  it('keeps the 40 biggest people and tags, counting the rest as hidden', () => {
    const specs: Spec[] = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, people: [person(100 + i, `P${i}`)], tags: [] }))
    const g = graphOf(specs)
    expect(g.nodes).toHaveLength(40)
    expect(g.hidden).toBe(10)
  })

  it('lays the bubbles out inside the field, apart, the same way every time', () => {
    const g = graphOf(TWO_TEAMS)
    const a = layoutClusters(g, 600, 400)
    expect(layoutClusters(g, 600, 400)).toEqual(a)
    for (const n of a.nodes) {
      expect(n.x - n.r).toBeGreaterThanOrEqual(0)
      expect(n.x + n.r).toBeLessThanOrEqual(600)
      expect(n.y + n.r).toBeLessThanOrEqual(400)
    }
    for (let i = 0; i < a.nodes.length; i++) {
      for (let j = i + 1; j < a.nodes.length; j++) {
        const p = a.nodes[i]!
        const q = a.nodes[j]!
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(p.r + q.r - 1)
      }
    }
    // A halo round each cluster of two or more.
    expect(a.halos.map((h) => h.cluster)).toEqual([0, 1])
  })

  it('draws nothing without people or tags', () => {
    const g = graphOf([{ id: 1, people: [], tags: [] }])
    expect(g.nodes).toEqual([])
    expect(layoutClusters(g, 300, 200)).toEqual({ nodes: [], halos: [] })
  })
})
