/**
 * Writes the dev seed — a realistic, production-shaped v49 export — for
 * manual testing in the dev server.
 *
 *   npm run seed:dev                          → dev-data/seed-v49.json
 *   npm run seed:dev -- --out some/file.json  → custom path
 *   npm run seed:dev -- --date 2026-11-02     → as if run on that day
 *
 * Then: dev server (`npm run dev`) → Settings → Import JSON → pick the file.
 * Importing replaces the whole database of that browser origin.
 *
 * Dates are relative to the run day; same-day runs write identical files.
 * What the seed contains and which upgrade steps it exercises: see the
 * header of `scripts/dev-seed.ts`. `dev-data/` is gitignored.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { generateDevSeed } from './dev-seed.ts'

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

const out = resolve(argValue('--out') ?? 'dev-data/seed-v49.json')
const seed = generateDevSeed(runDay())
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(seed, null, 2)}\n`)

const completed = seed.todos.filter((t) => t.isCompleted === true).length
console.log(
  `Wrote ${out}\n` +
  `  v${seed.__schemaVersion} export: ${seed.todos.length} tasks (${completed} completed), ` +
  `${seed.projects.length} projects, ${seed.people.length} people, ${seed.orgs.length} orgs, ` +
  `${seed.tags.length} tags, ${seed.listDefinitions.length} lists, ${seed.todoEvents.length} events\n` +
  '  Load it via Settings → Import JSON in the dev server.',
)
