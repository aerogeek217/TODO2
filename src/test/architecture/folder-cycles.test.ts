import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * No import cycles between folders of `src/`: each of `components/<area>`,
 * the other top-level folders (`stores`, `services`, `data`, `hooks`,
 * `utils`, `models`, `views`, …) and each top-level file is a node, every
 * relative import (static, dynamic, CSS, and CSS `composes … from`) an edge,
 * and every strongly connected group of more than one node fails. The
 * allow-listed edges below are left out of the graph; each must still exist
 * (so its entry goes when the edge does).
 */

/** Folder edges left out of the check, until they're removed: [from, to]. */
const ALLOWED_EDGES: readonly (readonly [string, string])[] = []

const SRC = path.resolve(__dirname, '../..')

function nodeOf(file: string): string {
  const parts = path.relative(SRC, file).split(path.sep)
  if (parts[0] === 'components' && parts.length > 2) return `components/${parts[1]}`
  return parts[0] ?? ''
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (p !== path.join(SRC, 'test')) sourceFiles(p, out)
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g

function folderGraph(): Map<string, Map<string, string>> {
  const edges = new Map<string, Map<string, string>>()
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8')
    const from = nodeOf(file)
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1]
      if (!spec) continue
      const to = nodeOf(path.resolve(path.dirname(file), spec))
      if (to === from) continue
      const out = edges.get(from) ?? new Map<string, string>()
      if (!out.has(to)) out.set(to, `${path.relative(SRC, file)} → ${spec}`)
      edges.set(from, out)
    }
  }
  return edges
}

/** Tarjan's strongly connected components. */
function cycles(edges: Map<string, Map<string, string>>): string[][] {
  const nodes = new Set<string>([...edges.keys(), ...[...edges.values()].flatMap((m) => [...m.keys()])])
  let index = 0
  const idx = new Map<string, number>()
  const low = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const out: string[][] = []
  const visit = (v: string) => {
    idx.set(v, index)
    low.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)
    for (const w of edges.get(v)?.keys() ?? []) {
      if (!idx.has(w)) {
        visit(w)
        low.set(v, Math.min(low.get(v)!, low.get(w)!))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!))
      }
    }
    if (low.get(v) === idx.get(v)) {
      const scc: string[] = []
      let w: string | undefined
      do {
        w = stack.pop()
        if (w === undefined) break
        onStack.delete(w)
        scc.push(w)
      } while (w !== v)
      if (scc.length > 1) out.push(scc.sort())
    }
  }
  for (const v of nodes) if (!idx.has(v)) visit(v)
  return out
}

const key = (group: readonly string[]) => [...group].sort().join(' ↔ ')

describe('folder import cycles', () => {
  const edges = folderGraph()
  const checked = new Map([...edges].map(([from, out]) => [
    from,
    new Map([...out].filter(([to]) => !ALLOWED_EDGES.some(([a, b]) => a === from && b === to))),
  ]))
  const found = cycles(checked)

  it('has none', () => {
    const unexpected = found.map((scc) => {
      // Name one import per edge inside the cycle, so the failure says where to look.
      const inside = new Set(scc)
      const where = scc.flatMap((a) => [...(edges.get(a) ?? [])].filter(([b]) => inside.has(b)).map(([b, at]) => `  ${a} → ${b}: ${at}`))
      return `${key(scc)}\n${where.join('\n')}`
    })
    expect(unexpected).toEqual([])
  })

  it('still has every allow-listed edge (remove the entry once it is gone)', () => {
    expect(ALLOWED_EDGES.filter(([a, b]) => !edges.get(a)?.has(b))).toEqual([])
  })

  it('sees the folders (the scan is not empty)', () => {
    expect(edges.get('components/workspace')?.has('stores')).toBe(true)
    expect(edges.get('services')?.has('data')).toBe(true)
  })
})
