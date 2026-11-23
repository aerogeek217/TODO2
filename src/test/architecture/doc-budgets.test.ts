import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The docs stay small enough to load. `docs/ARCHITECTURE.md` is read into
 * every session, so it is a map with a word budget. How a feature behaves is
 * in one file per feature under `docs/architecture/features/`, each with its
 * own budget and each listed in the map. A layer table under
 * `docs/architecture/` has one row per module, and a row says what the module
 * is, where it is and what it is for. A word is a run of non-whitespace.
 *
 * Over budget: move the detail from the map or the row to the feature file,
 * or split the feature file in two and list both in the map ("Keeping the
 * docs short" there says what goes where).
 */

const MAP_WORDS = 3000
const FEATURE_WORDS = 4000
const ROW_WORDS = 300

const DOCS = path.resolve(__dirname, '../../../docs')
const MAP = path.join(DOCS, 'ARCHITECTURE.md')
const FEATURES = path.join(DOCS, 'architecture', 'features')

/** The layer tables held to the row budget. */
const LAYER_TABLES = ['testing.md', 'state.md', 'models-and-data.md']

/**
 * The other layer tables still have rows over the budget, so they are held by a
 * ratchet instead: the baseline lists each file's long rows by key, each with
 * its word count, and it only shrinks. A long row the baseline does not list
 * fails, a listed row that grows fails, and an entry whose row is at or under
 * the budget, or gone, fails until it is deleted. A file whose entries are all
 * gone belongs in `LAYER_TABLES`: delete it from the baseline and add it there.
 */
const BASELINE = path.join(__dirname, 'doc-budgets.baseline.json')
const ROW_ADVICE =
  'A row says what the module is, where it is and what it is for. Move how it behaves to its feature file under docs/architecture/features/.'

const read = (file: string): string => fs.readFileSync(file, 'utf8')
const wordCount = (file: string): number => read(file).split(/\s+/).filter(Boolean).length
const featureFiles = (): string[] =>
  fs
    .readdirSync(FEATURES)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => path.join(FEATURES, name))
const layerTables = (): string[] => LAYER_TABLES.map((name) => path.join(DOCS, 'architecture', name))
const shown = (file: string): string => path.relative(DOCS, file).split(path.sep).join('/')

interface TableRow {
  line: number
  text: string
  words: number
}

/** A file's table rows, leaving out the separator rows. A row's words leave out the pipes between its cells. */
function tableRows(file: string): TableRow[] {
  return read(file)
    .split(/\r?\n/)
    .flatMap((raw, index) => {
      const text = raw.trim()
      if (!text.startsWith('|') || /^\|[\s:|-]+$/.test(text)) return []
      const words = text.split(/\s+/).filter((word) => word && word !== '|').length
      return [{ line: index + 1, text, words }]
    })
}

/** A file's table rows over the row budget. */
function longRows(file: string): string[] {
  return tableRows(file)
    .filter((row) => row.words > ROW_WORDS)
    .map((row) => `${shown(file)}:${row.line} has ${row.words} words`)
}

/** A cell's first name: its text up to the first comma, semicolon, middle dot or parenthesis. */
const firstName = (cell: string): string => (cell.split(/[,;·(]/)[0] ?? '').trim()

/**
 * Each row's key in the baseline: the first name in its name cell, followed by
 * ` @ ` and the first name in its location cell when another row of the file
 * starts with the same name. Line numbers would change with every edit above.
 */
function rowKeys(rows: TableRow[]): string[] {
  const cells = rows.map((row) => row.text.split(/(?<!\\)\|/).slice(1, 3).map(firstName))
  const uses = new Map<string, number>()
  for (const [name = ''] of cells) uses.set(name, (uses.get(name) ?? 0) + 1)
  return cells.map(([name = '', location = '']) => ((uses.get(name) ?? 0) > 1 ? `${name} @ ${location}` : name))
}

/** A ratcheted file's rows over the row budget, each with its key. */
function keyedLongRows(name: string): (TableRow & { key: string })[] {
  const file = path.join(DOCS, 'architecture', name)
  if (!fs.existsSync(file)) return []
  const rows = tableRows(file)
  const keys = rowKeys(rows)
  return rows.map((row, i) => ({ ...row, key: keys[i] ?? '' })).filter((row) => row.words > ROW_WORDS)
}

/** The baseline: for each ratcheted file, its long rows' keys and word counts. */
const baseline = (): Map<string, Map<string, number>> => {
  const parsed = JSON.parse(read(BASELINE)) as Record<string, Record<string, number>>
  return new Map(Object.entries(parsed).map(([name, rows]) => [name, new Map(Object.entries(rows))]))
}

/**
 * The files a doc links to: every `[text](target)` that is not a URL or a
 * bare `#anchor`. A link written inside a code span is text, not a link.
 */
function linkedFiles(file: string): string[] {
  const out: string[] = []
  const prose = read(file).replace(/`[^`\n]*`/g, '')
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = (m[1] ?? '').split('#')[0] ?? ''
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    out.push(path.resolve(path.dirname(file), target))
  }
  return out
}

describe('doc budgets', () => {
  it(`keeps docs/ARCHITECTURE.md, the always-loaded map, to ${MAP_WORDS} words`, () => {
    const count = wordCount(MAP)
    expect(
      count,
      `docs/ARCHITECTURE.md has ${count} words. Move the detail to a file under docs/architecture/features/.`,
    ).toBeLessThanOrEqual(MAP_WORDS)
  })

  it(`keeps each feature file to ${FEATURE_WORDS} words`, () => {
    const over = featureFiles()
      .map((file) => ({ file: shown(file), words: wordCount(file) }))
      .filter((entry) => entry.words > FEATURE_WORDS)
    expect(over, 'Split an over-budget feature file in two and list both in docs/ARCHITECTURE.md.').toEqual([])
  })

  it(`keeps each layer-table row to ${ROW_WORDS} words`, () => {
    const over = layerTables().flatMap(longRows)
    expect(
      over,
      'A row says what the module is, where it is and what it is for. Move how it behaves to its feature file.',
    ).toEqual([])
  })

  it(`adds no row over ${ROW_WORDS} words to a ratcheted layer table`, () => {
    const added = [...baseline()].flatMap(([name, listed]) => {
      const seen = new Set<string>()
      return keyedLongRows(name)
        .filter((row) => {
          const repeated = seen.has(row.key)
          seen.add(row.key)
          return repeated || !listed.has(row.key)
        })
        .map((row) => `${name}:${row.line} "${row.key}" has ${row.words} words and is not in the baseline`)
    })
    expect(added, ROW_ADVICE).toEqual([])
  })

  it('lets no long row in the baseline grow', () => {
    const grown = [...baseline()].flatMap(([name, listed]) =>
      keyedLongRows(name).flatMap((row) => {
        const recorded = listed.get(row.key)
        return recorded !== undefined && row.words > recorded
          ? [`${name}:${row.line} "${row.key}" has ${row.words} words, up from ${recorded}`]
          : []
      }),
    )
    expect(grown, ROW_ADVICE).toEqual([])
  })

  it('keeps the baseline to rows still over budget', () => {
    const stale = [...baseline()].flatMap(([name, listed]) => {
      if (listed.size === 0) return [`${name} has no entries: delete it from the baseline and add it to LAYER_TABLES`]
      const long = new Set(keyedLongRows(name).map((row) => row.key))
      return [...listed.keys()]
        .filter((key) => !long.has(key))
        .map((key) => `${name} "${key}" is at or under ${ROW_WORDS} words, or gone`)
    })
    expect(stale, 'Delete each entry from src/test/architecture/doc-budgets.baseline.json, so the baseline only shrinks.').toEqual([])
  })

  it('lists every feature file in the map', () => {
    const listed = new Set(linkedFiles(MAP))
    const unlisted = featureFiles()
      .filter((file) => !listed.has(file))
      .map(shown)
    expect(unlisted, 'Add each to the Features table in docs/ARCHITECTURE.md.').toEqual([])
  })

  it('links only to files that exist', () => {
    const broken = [MAP, ...featureFiles(), ...layerTables()].flatMap((file) =>
      linkedFiles(file)
        .filter((target) => !fs.existsSync(target))
        .map((target) => `${shown(file)} → ${shown(target)}`),
    )
    expect(broken).toEqual([])
  })
})
