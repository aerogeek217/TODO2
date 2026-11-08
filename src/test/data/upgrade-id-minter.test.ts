import { describe, expect, it } from 'vitest'
import { idMinter } from '../../data/upgrades/id-minter'
import { upgradeV76 } from '../../data/upgrades/v76-layout-rows'
import { upgradeV77 } from '../../data/upgrades/v77-dashboard-widgets'
import type { DataRow } from '../../data/schema-upgrades'

/** The minter v76 / v77 shipped with: probes 1, 2, 3, … from the start every time. */
function plainMinter(taken: Set<string>, maxLen: number, separator: string) {
  return (base: unknown, suffix: string): string => {
    const stem = typeof base === 'string' && base !== '' ? base : 'part'
    for (let n = 1; ; n++) {
      const tail = n === 1 ? suffix : `${suffix}${separator}${n}`
      const id = `${stem.slice(0, maxLen - tail.length)}${tail}`
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
  }
}

/** A small seeded random (mulberry32), so a failure reproduces. */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DATE = '2026-11-01T09:00:00.000Z'
const layout = (body: Record<string, unknown>): DataRow => ({ id: 1, name: 'Big', sortOrder: 0, createdAt: DATE, modifiedAt: DATE, ...body })

describe('the layout upgrades’ id minter (cr33 S1)', () => {
  it('mints the ids the plain probe mints, call for call', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = random(seed)
      const maxLen = 6 + Math.floor(rnd() * 10)
      const separator = seed % 2 === 0 ? '' : '_'
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
      // Short and long bases, some sharing a prefix past the cut, some taken already, odd bases.
      const bases: unknown[] = ['a', 'ab', 'abcdefghijklmnop', 'abcdefghijklmnoq', 'x'.repeat(30), 'x'.repeat(29) + 'y', '', null, 7, 'k1-r']
      const suffixes = ['-r', '-c', '-t', '-r2', 'x']
      const seeded = new Set<string>()
      for (let i = 0; i < 30; i++) seeded.add(`${pick(['a', 'ab', 'x'.repeat(4), 'k1', 'part'])}${pick(suffixes)}${pick(['', '2', '_2', '3', '_3', '10', '_10'])}`.slice(0, maxLen))
      const fast = idMinter(new Set(seeded), maxLen, separator)
      const plain = plainMinter(new Set(seeded), maxLen, separator)
      for (let i = 0; i < 400; i++) {
        const base = pick(bases)
        const suffix = pick(suffixes)
        expect(fast(base, suffix)).toBe(plain(base, suffix))
      }
    }
  })

  it('a v76 file of 20,000 same-id cells upgrades in well under a second, to the same ids as before', () => {
    const cells = Array.from({ length: 20_000 }, () => ({ id: 'same', weight: 1, tabs: [] }))
    const t0 = performance.now()
    const out = upgradeV76({ layouts: [layout({ columns: [{ id: 'A', weight: 1, cells }] })] }).layouts![0]!
    const ms = performance.now() - t0
    const rows = (out.columns as Array<{ rows: Array<{ id: string }> }>)[0]!.rows
    expect(rows[0]!.id).toBe('same-r')
    expect(rows[1]!.id).toBe('same-r2')
    expect(rows[19_999]!.id).toBe('same-r20000')
    expect(ms).toBeLessThan(1000)
  })

  it('cells whose 100-character ids share their first 95 characters mint quickly too', () => {
    const prefix = 'p'.repeat(95)
    const cells = Array.from({ length: 10_000 }, (_, i) => ({ id: `${prefix}${String(i).padStart(5, '0')}`, weight: 1, tabs: [] }))
    const t0 = performance.now()
    const out = upgradeV76({ layouts: [layout({ columns: [{ id: 'A', weight: 1, cells }] })] }).layouts![0]!
    expect(performance.now() - t0).toBeLessThan(1000)
    const ids = (out.columns as Array<{ rows: Array<{ id: string }> }>)[0]!.rows.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every((id) => id.length <= 100)).toBe(true)
  })

  it('a v77 file of 3,000 same-id Dashboard tabs upgrades in a few seconds at most (it took 14 s), every id unique', () => {
    const rows = Array.from({ length: 3_000 }, () => ({ id: 'r', weight: 1, cells: [{ id: 'c', weight: 1, tabs: [{ id: 'd', kind: 'dashboard', config: {} }] }] }))
    const t0 = performance.now()
    const out = upgradeV77({ layouts: [layout({ columns: [{ id: 'A', weight: 1, rows }] })] }).layouts![0]!
    expect(performance.now() - t0).toBeLessThan(3000)
    const ids: string[] = []
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk)
      else if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>
        if (typeof o.id === 'string') ids.push(o.id)
        for (const [k, v] of Object.entries(o)) if (k !== 'id' && k !== 'config') walk(v)
      }
    }
    walk(out.columns)
    // The column, and the parts minted from the shared ids, each once.
    expect(new Set(ids).size).toBe(ids.length)
  })
})
