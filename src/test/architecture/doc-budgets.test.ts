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

/** A file's table rows over the row budget. A row's words leave out the pipes between its cells. */
function longRows(file: string): string[] {
  const out: string[] = []
  read(file)
    .split(/\r?\n/)
    .forEach((text, index) => {
      const line = text.trim()
      if (!line.startsWith('|') || /^\|[\s:|-]+$/.test(line)) return
      const words = line.split(/\s+/).filter((word) => word && word !== '|').length
      if (words > ROW_WORDS) out.push(`${shown(file)}:${index + 1} has ${words} words`)
    })
  return out
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
