import type { TodoItem } from '../models/todo-item'
import { daysUntil } from './effective-date'
import { neglectJitter } from './neglect-map'

/**
 * Work clusters (task maps B2, 2026-11-18): people and tags as bubbles sized
 * by their open tasks, a person joined to a tag by the tasks they share.
 * Clusters are found on that graph by weighted label propagation (every
 * step in a fixed order: the same data gives the same clusters), and each
 * is named by its biggest tag (else its biggest person). The layout is a
 * small force simulation, also deterministic: no `Math.random`.
 */

/** At most this many bubbles: the biggest; the rest are counted as hidden. */
const CLUSTER_NODES_MAX = 40

type NodeKind = 'person' | 'tag'

export interface ClusterNode {
  /** `p:<id>` / `t:<id>`. */
  key: string
  kind: NodeKind
  id: number
  name: string
  color?: string
  /** Open tasks it has. */
  count: number
  /** Of those, overdue. */
  overdue: number
  /** Its cluster's index in `ClusterGraph.clusters`. */
  cluster: number
}

interface ClusterLink {
  /** Indices in `ClusterGraph.nodes`: a person, then a tag. */
  a: number
  b: number
  /** Tasks with both. */
  weight: number
  /** Its two ends are in different clusters. */
  bridge: boolean
}

interface Cluster {
  name: string
  /** Indices in `ClusterGraph.nodes`, the biggest first. */
  nodes: number[]
  /** Its open tasks: each task of any of its people or tags, once, in the order given. */
  todoIds: number[]
  overdue: number
}

export interface ClusterGraph {
  nodes: ClusterNode[]
  links: ClusterLink[]
  /** The biggest first (by tasks); a lone person or tag with no link is a cluster of one. */
  clusters: Cluster[]
  /** People and tags left out past `CLUSTER_NODES_MAX`. */
  hidden: number
}

type Named = { id?: number; name: string; color?: string }

interface ClusterInput<T> {
  todos: readonly T[]
  peopleOf: (todoId: number) => readonly Named[] | undefined
  tagsOf: (todoId: number) => readonly Named[] | undefined
  today: Date
}

type ClusterFields = Pick<TodoItem, 'isCompleted' | 'dueDate'> & { id: number }

/** The graph of the open tasks' people and tags. */
export function buildClusterGraph<T extends ClusterFields>({ todos, peopleOf, tagsOf, today }: ClusterInput<T>): ClusterGraph {
  interface Acc { key: string; kind: NodeKind; id: number; name: string; color?: string; todos: number[]; overdue: number }
  const acc = new Map<string, Acc>()
  const pairs = new Map<string, number>()
  const overdueIds = new Set<number>()
  for (const t of todos) {
    if (t.isCompleted) continue
    const late = (daysUntil(t.dueDate, today) ?? 0) < 0
    if (late) overdueIds.add(t.id)
    const ends: string[][] = [[], []]
    const add = (kind: NodeKind, e: Named) => {
      if (e.id == null) return
      const key = `${kind === 'person' ? 'p' : 't'}:${e.id}`
      let a = acc.get(key)
      if (!a) {
        a = { key, kind, id: e.id, name: e.name, ...(e.color ? { color: e.color } : {}), todos: [], overdue: 0 }
        acc.set(key, a)
      }
      if (a.todos.at(-1) === t.id) return
      a.todos.push(t.id)
      if (late) a.overdue++
      ends[kind === 'person' ? 0 : 1]!.push(key)
    }
    for (const p of peopleOf(t.id) ?? []) add('person', p)
    for (const g of tagsOf(t.id) ?? []) add('tag', g)
    for (const p of ends[0]!) for (const g of ends[1]!) pairs.set(`${p}|${g}`, (pairs.get(`${p}|${g}`) ?? 0) + 1)
  }

  const ranked = [...acc.values()].sort((a, b) => b.todos.length - a.todos.length || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
  const kept = ranked.slice(0, CLUSTER_NODES_MAX)
  const index = new Map(kept.map((n, i) => [n.key, i]))
  const links: ClusterLink[] = []
  for (const [pair, weight] of pairs) {
    const [p, g] = pair.split('|') as [string, string]
    const a = index.get(p)
    const b = index.get(g)
    if (a != null && b != null) links.push({ a, b, weight, bridge: false })
  }
  links.sort((x, y) => x.a - y.a || x.b - y.b)

  // Label propagation: each node, biggest first, takes the label its links weigh most (a tie keeps
  // its own, else the lowest); until nothing changes, at most 30 rounds.
  const label = kept.map((_, i) => i)
  const adj: Array<Array<[number, number]>> = kept.map(() => [])
  for (const l of links) {
    adj[l.a]!.push([l.b, l.weight])
    adj[l.b]!.push([l.a, l.weight])
  }
  for (let round = 0; round < 30; round++) {
    let changed = false
    for (let i = 0; i < kept.length; i++) {
      const near = adj[i]!
      if (near.length === 0) continue
      const weigh = new Map<number, number>()
      for (const [j, w] of near) weigh.set(label[j]!, (weigh.get(label[j]!) ?? 0) + w)
      const own = label[i]!
      let best = own
      let bestW = weigh.get(own) ?? 0
      for (const [l, w] of weigh) {
        if (w > bestW || (w === bestW && best !== own && l < best)) {
          best = l
          bestW = w
        }
      }
      if (best !== label[i]) {
        label[i] = best
        changed = true
      }
    }
    if (!changed) break
  }

  // The clusters, the biggest first.
  const groups = new Map<number, number[]>()
  kept.forEach((_, i) => {
    const g = groups.get(label[i]!) ?? []
    g.push(i)
    groups.set(label[i]!, g)
  })
  const clusters: Cluster[] = [...groups.values()].map((members) => {
    const ids = new Set<number>()
    for (const i of members) for (const id of kept[i]!.todos) ids.add(id)
    const todoIds = [...ids]
    const tags = members.filter((i) => kept[i]!.kind === 'tag')
    const namer = tags.at(0) ?? members[0]!
    return { name: kept[namer]!.name, nodes: members, todoIds, overdue: todoIds.filter((id) => overdueIds.has(id)).length }
  }).sort((a, b) => b.todoIds.length - a.todoIds.length || a.name.localeCompare(b.name))

  const clusterOf = new Map<number, number>()
  clusters.forEach((c, ci) => { for (const i of c.nodes) clusterOf.set(i, ci) })
  const nodes: ClusterNode[] = kept.map((n, i) => ({
    key: n.key, kind: n.kind, id: n.id, name: n.name, ...(n.color ? { color: n.color } : {}),
    count: n.todos.length, overdue: n.overdue, cluster: clusterOf.get(i) ?? 0,
  }))
  for (const l of links) l.bridge = nodes[l.a]!.cluster !== nodes[l.b]!.cluster
  return { nodes, links, clusters, hidden: ranked.length - kept.length }
}

interface PlacedNode {
  x: number
  y: number
  r: number
}

interface PlacedHalo {
  cluster: number
  x: number
  y: number
  r: number
}

interface ClusterLayout {
  nodes: PlacedNode[]
  /** A halo round each cluster of two or more. */
  halos: PlacedHalo[]
}

/** A bubble's radius before scaling: a tag a little larger than a person of the same count. */
function baseRadius(n: ClusterNode): number {
  return (n.kind === 'tag' ? 13 : 10) + Math.sqrt(n.count) * (n.kind === 'tag' ? 2.8 : 2.4)
}

/**
 * Places `graph` in a field `width` × `height`: each cluster gets a home round
 * an ellipse (the biggest first, an arc as long as its share of the bubbles),
 * then 300 steps of repulsion (stronger between clusters), springs along the
 * links inside a cluster (shorter the more tasks they carry), a pull to the
 * cluster's home, and no overlaps. The
 * bubbles are scaled to fill about a quarter of the field.
 */
export function layoutClusters(graph: ClusterGraph, width: number, height: number): ClusterLayout {
  const W = Math.max(1, width)
  const H = Math.max(1, height)
  const { nodes, links, clusters } = graph
  if (nodes.length === 0) return { nodes: [], halos: [] }
  const base = nodes.map(baseRadius)
  const area = base.reduce((s, r) => s + Math.PI * r * r, 0)
  const scale = Math.min(1.6, Math.sqrt((0.26 * W * H) / area))
  const radius = base.map((r) => Math.max(6, r * scale))

  // Each cluster's home: round an ellipse, the biggest first, each taking an arc as long as its
  // bubbles' share of the area (one cluster: the middle).
  const k = clusters.length
  const areaOf = clusters.map((c) => c.nodes.reduce((s, i) => s + radius[i]! * radius[i]!, 0))
  const total = areaOf.reduce((s, a) => s + a, 0) || 1
  let swept = 0
  const home = clusters.map((_, ci) => {
    const share = areaOf[ci]! / total
    const angle = 2 * Math.PI * (swept + share / 2) - Math.PI / 2
    swept += share
    if (k === 1) return { x: W / 2, y: H / 2 }
    return { x: W / 2 + Math.cos(angle) * W * 0.27, y: H / 2 + Math.sin(angle) * H * 0.25 }
  })
  const pos = nodes.map((n, i) => ({
    x: home[n.cluster]!.x + neglectJitter(i + 1, 7) * W * 0.05,
    y: home[n.cluster]!.y + neglectJitter(i + 1, 8) * H * 0.05,
    vx: 0,
    vy: 0,
  }))
  const pad = 6
  const steps = 300
  for (let it = 0; it < steps; it++) {
    const alpha = 1 - it / steps
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!
        const b = pos[j]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy + 0.01
        const d = Math.sqrt(d2)
        const same = nodes[i]!.cluster === nodes[j]!.cluster
        const f = ((same ? 40 : 300) * (radius[i]! + radius[j]!) / d2) * alpha
        a.vx -= (dx / d) * f; a.vy -= (dy / d) * f
        b.vx += (dx / d) * f; b.vy += (dy / d) * f
      }
    }
    for (const l of links) {
      if (l.bridge) continue
      const a = pos[l.a]!
      const b = pos[l.b]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01
      const target = radius[l.a]! + radius[l.b]! + Math.max(10, 40 * scale - l.weight * 2)
      const f = (d - target) * 0.02 * alpha
      a.vx += (dx / d) * f; a.vy += (dy / d) * f
      b.vx -= (dx / d) * f; b.vy -= (dy / d) * f
    }
    pos.forEach((p, i) => {
      const h = home[nodes[i]!.cluster]!
      p.vx += (h.x - p.x) * 0.06 * alpha
      p.vy += (h.y - p.y) * 0.06 * alpha
      p.x += p.vx; p.y += p.vy
      p.vx *= 0.6; p.vy *= 0.6
    })
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i]!
        const b = pos[j]!
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.sqrt(dx * dx + dy * dy) + 0.01
        const min = radius[i]! + radius[j]! + pad
        if (d < min) {
          const push = (min - d) / 2
          a.x -= (dx / d) * push; a.y -= (dy / d) * push
          b.x += (dx / d) * push; b.y += (dy / d) * push
        }
      }
    }
    pos.forEach((p, i) => {
      const r = radius[i]!
      p.x = Math.max(r + 2, Math.min(W - r - 2, p.x))
      p.y = Math.max(r + 18, Math.min(H - r - 2, p.y))
    })
  }

  const placed = pos.map((p, i) => ({ x: p.x, y: p.y, r: radius[i]! }))
  const halos: PlacedHalo[] = []
  clusters.forEach((c, ci) => {
    if (c.nodes.length < 2) return
    let cx = 0
    let cy = 0
    for (const i of c.nodes) { cx += placed[i]!.x; cy += placed[i]!.y }
    cx /= c.nodes.length
    cy /= c.nodes.length
    let r = 0
    for (const i of c.nodes) r = Math.max(r, Math.hypot(placed[i]!.x - cx, placed[i]!.y - cy) + placed[i]!.r + 10)
    halos.push({ cluster: ci, x: cx, y: cy, r })
  })
  return { nodes: placed, halos }
}
