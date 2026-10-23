/**
 * Writes the dev seed — a realistic export in the current schema — for
 * manual testing in the dev server.
 *
 *   npm run seed:dev                          → dev-data/seed-v<schema>.json
 *   npm run seed:dev -- --out some/file.json  → custom path
 *   npm run seed:dev -- --date 2026-11-02     → as if run on that day
 *
 * Then: dev server (`npm run dev`) → Settings → Import / Export → Import
 * JSON → pick the file.
 * Importing replaces the whole database of that browser origin.
 *
 * Dates are relative to the run day; same-day runs write identical files.
 * What the seed contains: see the header of `scripts/dev-seed.ts`.
 * `dev-data/` is gitignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DEV_SEED_SCHEMA_VERSION, generateDevSeed } from './dev-seed.ts'

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function runDay(): Date {
  const raw = argValue('--date')
  if (!raw) return new Date()
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!match) throw new Error(`--date must be YYYY-MM-DD, got "${raw}"`)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

const out = resolve(argValue('--out') ?? `dev-data/seed-v${DEV_SEED_SCHEMA_VERSION}.json`)
const seed = generateDevSeed(runDay())
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(seed, null, 2)}\n`)

const completed = seed.todos.filter((t) => t.isCompleted).length
const projectTags = seed.tags.filter((t) => t.name.startsWith('Project: ')).length
console.log(
  `Wrote ${out}\n` +
  `  v${seed.__schemaVersion} export: ${seed.todos.length} tasks (${completed} completed), ` +
  `${seed.people.length} people, ${seed.tags.length} tags (${projectTags} projects), ` +
  `${seed.listDefinitions.length} lists, ${seed.layouts.length} layouts, ${seed.todoEvents.length} events\n` +
  '  Load it via Settings → Import / Export → Import JSON in the dev server.',
)
