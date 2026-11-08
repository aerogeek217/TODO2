/**
 * The id minter of the layout upgrades (v76, v77): `<base><suffix>`, and when
 * that is taken `<base><suffix><separator>2`, `…3`, …, each cut to `maxLen`
 * by shortening the base — the first one not in `taken` (which every id it
 * mints joins).
 *
 * It remembers, per candidate sequence, the first number not yet known to be
 * taken, and resumes there: `taken` only grows, so the first free number of a
 * sequence never goes down, and the ids minted are the ones the plain probe
 * from 1 gives — in linear time, where the plain probe was quadratic in the
 * parts sharing a base (cr33 S1: a few thousand same-id parts in a file hung
 * its import, and every launch from a planted sync file).
 */
export function idMinter(
  taken: Set<string>,
  maxLen: number,
  separator: string,
): (base: unknown, suffix: string) => string {
  // A candidate is `base.slice(0, maxLen - tail.length) + tail`, so two bases
  // with the same cut share every candidate whose tail has that length: the
  // sequence is keyed by the cut base, the suffix and the tail's length.
  const nextOf = new Map<string, number>()
  return (base, suffix) => {
    const stem = typeof base === 'string' && base !== '' ? base : 'part'
    let n = 1
    for (;;) {
      const tail = n === 1 ? suffix : `${suffix}${separator}${n}`
      const cut = stem.slice(0, maxLen - tail.length)
      const key = `${tail.length}\u0000${suffix}\u0000${cut}`
      const resume = nextOf.get(key)
      if (resume !== undefined && resume > n) {
        n = resume
        continue
      }
      nextOf.set(key, n + 1)
      const id = `${cut}${tail}`
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
      n++
    }
  }
}
