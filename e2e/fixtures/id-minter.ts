/**
 * The ids `column-layout` gives new tracks: `<base><suffix>`, and when that
 * is taken `<base><suffix><separator>2`, `…3`, …, each cut to `maxLen` by
 * shortening the base — the first one not in `taken` (which every id it
 * mints joins). It remembers, per candidate sequence, the first number not
 * yet known to be taken, and resumes there.
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
