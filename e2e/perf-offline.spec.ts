import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Browser, type CDPSession, type Page } from '@playwright/test'

/**
 * Timings of the built offline file (`dist/todo2.html`, opened from disk) at
 * a real size: the dev seed (`npm run seed:dev`, about 143 tasks) imported
 * through Settings, three layouts, the open one seven cells — a list of
 * every open task (about 110 rows) with two more tabs, a second list, a week
 * calendar, two Numbers, a Breakdown and Created vs completed.
 *
 * Not a regression test: it asserts nothing about speed. It prints, and
 * writes as JSON, for each scenario the time from the press to the frame
 * that shows the change (`shown`) and to the end of its view transition
 * (`settled`), the press's Event Timing duration (press → next paint), the
 * main thread's script / style / layout time, long frames, and — for the
 * small interactions, from a trace — how many elements one style recalc
 * visited; and how many React components rendered and mounted (a stand-in
 * for the DevTools hook counts the fibers that did work in each commit). Each scenario runs `PERF_RUNS` times (default 5) after a
 * discarded warm-up; the table shows the median and the range.
 *
 * Runs only with `PERF=1`, on its own headless Chromium on the machine's GPU
 * (the flags below; without them headless paints in software and paint
 * times about double):
 *
 *   npm run seed:dev
 *   npm run build
 *   PERF=1 npx playwright test e2e/perf-offline.spec.ts --workers=1 --timeout=1800000
 *
 * (PowerShell: `$env:PERF='1'; npx playwright test …`.) Options:
 * `PERF_FILE=<path>` another built file (a kept baseline), `PERF_OUT=<path>`
 * the JSON (default `test-results/perf-offline.json`), `PERF_RUNS=<n>`,
 * `PERF_ONLY=<a,b>` scenario groups (`layout`, `press`, `tab`, `hover`,
 * `focus`, `type`, `complete`, `larger`, `add`, `idle`),
 * `PERF_AMBIENCE=off|asis` (default: on, under a night sky — the stars are
 * the ambience's costliest part — whatever the hour), `PERF_MOTION=reduce`,
 * `PERF_DROP_RULES=<regex>` (an experiment: every style rule whose selector
 * matches is deleted from the page before measuring — what a rule costs,
 * without a rebuild), `PERF_ADD_CSS=<css>` (the other way: a stylesheet
 * added to the page), `PERF_TRACE_DIR=<folder>` (the traced scenarios' raw
 * traces, with invalidation tracking and selector statistics, saved there).
 */

const PERF = process.env.PERF === '1'
test.skip(!PERF, 'set PERF=1 to measure the built offline file')

const ROOT = resolve(import.meta.dirname, '..')
const FILE = process.env.PERF_FILE ?? join(ROOT, 'dist', 'todo2.html')
const SEED = join(ROOT, 'dev-data', 'seed-v86.json')
const OUT = process.env.PERF_OUT ?? join(ROOT, 'test-results', 'perf-offline.json')
const RUNS = Math.max(1, Number(process.env.PERF_RUNS ?? 5))
const ONLY = (process.env.PERF_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const AMBIENCE = process.env.PERF_AMBIENCE ?? 'night'
const REDUCED = process.env.PERF_MOTION === 'reduce'
const DROP_RULES = process.env.PERF_DROP_RULES ?? ''
const ADD_CSS = process.env.PERF_ADD_CSS ?? ''
const TRACE_DIR = process.env.PERF_TRACE_DIR ?? ''
const TRACE_CATEGORIES = TRACE_DIR === ''
  ? ['devtools.timeline']
  : ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.invalidationTracking', 'disabled-by-default-blink.debug']

/** Headless Chromium on the GPU (ANGLE over D3D11 on Windows); the spec records the renderer it got. */
const GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--enable-gpu-rasterization']

const wants = (group: string) => ONLY.length === 0 || ONLY.includes(group)

const startedAt = Date.now()
/** A progress line (the run takes minutes). */
const say = (text: string) => { console.log(`[perf ${String(Math.round((Date.now() - startedAt) / 1000)).padStart(4)}s] ${text}`) }

// --- The data: the dev seed plus a seven-cell layout ----------------------

const EVERY_OPEN = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }

interface SeedFile {
  layouts: Array<{ id: number; name: string; sortOrder: number; cells: Array<{ id: string; tabs: Array<{ id: string; kind: string; config: Record<string, unknown> }> }> } & Record<string, unknown>>
  listDefinitions: Array<{ id: number; name: string; sortOrder: number } & Record<string, unknown>>
  settings: Array<{ key: string; value: string }>
  todos: Array<{ isCompleted: boolean }>
}

/** A place where it is about 23:00 by the sun right now: the ambience draws its night sky there. */
function nightPlace(): { lat: number; lon: number } {
  const now = new Date()
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60
  const lon = (((23 - utcHours) * 15 + 540) % 360) - 180
  return { lat: 45, lon: Math.round(lon * 100) / 100 }
}

/** The dev seed with layout `Seven` (seven cells, nine tabs) and its two lists added; `Seven` is the open one. */
function perfSeed(): string {
  const seed = JSON.parse(readFileSync(SEED, 'utf8')) as SeedFile
  const first = seed.layouts[0]
  if (!first) throw new Error('the dev seed has no layout')
  const tabOf = (id: string) => {
    for (const layout of seed.layouts) for (const cell of layout.cells) for (const tab of cell.tabs) if (tab.id === id) return structuredClone(tab)
    throw new Error(`the dev seed has no tab ${id}`)
  }
  const copy = (id: string, as: string) => ({ ...tabOf(id), id: as })
  const listId = Math.max(...seed.listDefinitions.map((l) => l.id)) + 1
  const layoutId = Math.max(...seed.layouts.map((l) => l.id)) + 1
  const week = seed.listDefinitions.find((l) => l.name === 'This week')
  if (!week) throw new Error('the dev seed has no “This week” list')
  seed.listDefinitions.push(
    { id: listId, name: 'Everything', sortOrder: 100, membership: { kind: 'custom', predicate: EVERY_OPEN }, sort: 'deadline', grouping: 'none', owner: { layoutId } },
    { ...structuredClone(week), id: listId + 1, name: 'Week', sortOrder: 101, owner: { layoutId } },
    { id: listId + 2, name: 'By status', sortOrder: 102, membership: { kind: 'custom', predicate: { ...EVERY_OPEN, statusIds: [1, 2, 3] } }, sort: 'deadline', grouping: 'status', owner: { layoutId } },
  )
  const cell = (id: string, col: number, row: number, colSpan: number, rowSpan: number, tabs: Array<{ id: string } & Record<string, unknown>>) =>
    ({ id, activeTabId: tabs[0]?.id, area: { col, row, colSpan, rowSpan }, tabs })
  seed.layouts.push({
    id: layoutId,
    name: 'Seven',
    sortOrder: seed.layouts.length,
    createdAt: first.createdAt,
    modifiedAt: first.modifiedAt,
    lastUsedAt: new Date().toISOString(),
    grid: {
      columns: [{ id: 'p7-c1', weight: 250 }, { id: 'p7-c2', weight: 250 }, { id: 'p7-c3', weight: 250 }, { id: 'p7-c4', weight: 250 }],
      rows: [{ id: 'p7-r1', weight: 95 }, { id: 'p7-r2', weight: 500 }, { id: 'p7-r3', weight: 300 }],
    },
    cells: [
      cell('p7-main', 0, 1, 2, 2, [
        { id: 'p7-all', kind: 'lens', config: { listDefinitionId: listId } },
        { id: 'p7-week', kind: 'lens', config: { listDefinitionId: listId + 1 } },
        { id: 'p7-notes', kind: 'notes', config: {} },
      ]),
      cell('p7-n1', 0, 0, 1, 1, [copy('tab-open', 'p7-open')]),
      cell('p7-n2', 1, 0, 1, 1, [copy('tab-late', 'p7-late')]),
      cell('p7-side', 2, 0, 1, 2, [{ id: 'p7-status', kind: 'lens', config: { listDefinitionId: listId + 2 } }]),
      cell('p7-cal', 3, 0, 1, 2, [copy('tab-cal', 'p7-calendar')]),
      cell('p7-bd', 2, 2, 1, 1, [copy('tab-people', 'p7-people')]),
      cell('p7-trend', 3, 2, 1, 1, [copy('tab-trend', 'p7-created')]),
    ],
  } as unknown as SeedFile['layouts'][number])
  const setting = (key: string, value: string) => {
    seed.settings = seed.settings.filter((s) => s.key !== key)
    seed.settings.push({ key, value })
  }
  setting('activeLayoutId', String(layoutId))
  if (AMBIENCE === 'off') setting('ambience', JSON.stringify({ enabled: false, place: null, sky: 'whisper', motion: 40, seasons: true }))
  else if (AMBIENCE !== 'asis') setting('ambience', JSON.stringify({ enabled: true, place: nightPlace(), sky: 'whisper', motion: 40, seasons: true }))
  return JSON.stringify(seed)
}

// --- The probe: what the page records about each interaction -------------

interface VtRecord { start: number; updated?: number; ready?: number; shown?: number; finished?: number; skipped?: boolean }
interface FrameRecord { start: number; duration: number; blocking: number }
interface EventRecord { name: string; start: number; duration: number }
interface PressRecord { at: number; type: string; target: string }
interface WatchRecord { hit?: number; shown?: number }
interface ReactRecord { commits: number; renders: number; mounts: number }

interface Probe {
  presses: PressRecord[]
  vt: VtRecord[]
  frames: FrameRecord[]
  events: EventRecord[]
  watch: WatchRecord | null
  react: ReactRecord
  reset(): void
  arm(selector: string, mode: 'present' | 'absent'): void
  settled(): Promise<void>
  flush(): void
}

declare global {
  interface Window { __perf?: Probe }
}

function installProbe(): void {
  let eventObserver: PerformanceObserver | null = null
  let frameObserver: PerformanceObserver | null = null
  const takeEvents = (list: PerformanceEntry[]) => {
    for (const e of list) probe.events.push({ name: e.name, start: e.startTime, duration: e.duration })
  }
  const takeFrames = (list: PerformanceEntry[]) => {
    for (const e of list) probe.frames.push({ start: e.startTime, duration: e.duration, blocking: (e as PerformanceEntry & { blockingDuration?: number }).blockingDuration ?? 0 })
  }
  const frame = () => new Promise<number>((done) => { requestAnimationFrame(done) })
  const probe: Probe = {
    presses: [],
    vt: [],
    frames: [],
    events: [],
    watch: null,
    react: { commits: 0, renders: 0, mounts: 0 },
    reset() {
      probe.flush()
      probe.presses = []
      probe.vt = []
      probe.frames = []
      probe.events = []
      probe.watch = null
      probe.react = { commits: 0, renders: 0, mounts: 0 }
    },
    // From now on, each frame: is `selector` there (or gone)? `hit` is the first frame it is, `shown` the frame after — the change is on screen.
    arm(selector, mode) {
      const watch: WatchRecord = {}
      probe.watch = watch
      const tick = () => {
        if (probe.watch !== watch) return
        const there = document.querySelector(selector) != null
        if (watch.hit == null) {
          if (there === (mode === 'present')) watch.hit = performance.now()
          requestAnimationFrame(tick)
        } else {
          watch.shown = performance.now()
        }
      }
      requestAnimationFrame(tick)
    },
    // The armed change is on screen, every view transition has ended, and two more frames have gone by.
    async settled() {
      const limit = performance.now() + 15_000
      for (;;) {
        await frame()
        const watching = probe.watch != null && probe.watch.shown == null
        const running = probe.vt.some((v) => v.finished == null && !v.skipped)
        if ((!watching && !running) || performance.now() > limit) break
      }
      await frame()
      await frame()
    },
    flush() {
      if (eventObserver) takeEvents(eventObserver.takeRecords())
      if (frameObserver) takeFrames(frameObserver.takeRecords())
    },
  }
  window.__perf = probe

  // React's renders, with no app code: a stand-in for the DevTools hook walks each committed fiber tree as
  // DevTools does (`e2e/fixtures/render-count.ts`) — a component rendered when it is new (a mount), or when
  // it was redone in this commit and did work; a subtree whose child list wasn't redone was skipped.
  interface Fiber { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null }
  const PERFORMED_WORK = 1
  // Function, class, forwardRef, memo and simple-memo components (React's work tags).
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15])
  const visit = (next: Fiber, prev: Fiber | null) => {
    if (COMPONENT_TAGS.has(next.tag)) {
      if (prev === null) {
        probe.react.mounts++
        probe.react.renders++
      } else if (next !== prev && (next.flags & PERFORMED_WORK) !== 0) {
        probe.react.renders++
      }
    }
    if (prev !== null && next.child === prev.child) return
    for (let c = next.child; c; c = c.sibling) visit(c, prev === null ? null : c.alternate)
  }
  const renderers = new Map<number, unknown>()
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    configurable: true,
    value: {
      renderers,
      supportsFiber: true,
      isDisabled: false,
      checkDCE() {},
      inject(internals: unknown) {
        const id = renderers.size + 1
        renderers.set(id, internals)
        return id
      },
      onCommitFiberRoot(_id: number, root: { current: Fiber }) {
        probe.react.commits++
        visit(root.current, root.current.alternate)
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      setStrictMode() {},
    },
  })

  const press = (e: Event) => {
    if (!e.isTrusted) return
    const target = e.target instanceof Element ? `${e.target.tagName.toLowerCase()}${e.target.id ? `#${e.target.id}` : ''}` : ''
    probe.presses.push({ at: e.timeStamp, type: e.type, target })
  }
  window.addEventListener('pointerdown', press, true)
  window.addEventListener('keydown', press, true)

  try {
    eventObserver = new PerformanceObserver((list) => takeEvents(list.getEntries()))
    eventObserver.observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit)
  } catch { /* no Event Timing */ }
  try {
    frameObserver = new PerformanceObserver((list) => takeFrames(list.getEntries()))
    frameObserver.observe({ type: 'long-animation-frame', buffered: false })
  } catch { /* no long animation frames */ }

  // A view transition's phases: started, its update callback done, ready (the animation starts), the frame after, finished.
  const start = (document as Partial<Document>).startViewTransition
  if (typeof start === 'function') {
    document.startViewTransition = function (this: Document, ...args: Parameters<Document['startViewTransition']>) {
      const rec: VtRecord = { start: performance.now() }
      probe.vt.push(rec)
      const transition = start.apply(document, args)
      transition.updateCallbackDone.then(() => { rec.updated = performance.now() }, () => {})
      transition.ready.then(() => {
        rec.ready = performance.now()
        requestAnimationFrame(() => { rec.shown = performance.now() })
      }, () => { rec.skipped = true })
      transition.finished.then(() => { rec.finished = performance.now() }, () => { rec.finished = performance.now() })
      return transition
    } as Document['startViewTransition']
  }
}

// --- One measured interaction -------------------------------------------

interface Sample {
  /** Press → the frame that shows the change (the watched selector, or the view transition's first frame), ms. */
  shown: number | null
  /** Press → every view transition over, ms (as `shown` where none ran). */
  settled: number | null
  /** The press's longest Event Timing duration (the event → the next paint), ms. */
  event: number | null
  script: number
  style: number
  layout: number
  styleCount: number
  layoutCount: number
  /** The longest long animation frame after the press, ms (0: none over 50 ms). */
  longest: number
  /** Long animation frames after the press, summed, ms. */
  longSum: number
  /** View transition phases, ms: the update callback (the old frame frozen), the animation. */
  vtUpdate: number | null
  vtAnim: number | null
  /** Press → the view transition's start (what the switch awaits first), ms. */
  vtStart: number | null
  /** React: commits, components rendered, components mounted. */
  commits: number
  renders: number
  mounts: number
  /**
   * From a trace: the largest style recalc's element count and its own time (what the interaction itself asked
   * for — the ambience's stars are styled on their own clock all through the window), every recalc's elements
   * summed, and all the recalc time.
   */
  maxElements?: number
  maxRecalcMs?: number
  elements?: number
  recalcMs?: number
  note?: string
}

interface Metrics { script: number; style: number; layout: number; styleCount: number; layoutCount: number }

async function metrics(cdp: CDPSession): Promise<Metrics> {
  const { metrics: list } = await cdp.send('Performance.getMetrics')
  const of = (name: string) => list.find((m) => m.name === name)?.value ?? 0
  return { script: of('ScriptDuration') * 1000, style: of('RecalcStyleDuration') * 1000, layout: of('LayoutDuration') * 1000, styleCount: of('RecalcStyleCount'), layoutCount: of('LayoutCount') }
}

interface Watch { selector: string; mode?: 'present' | 'absent' }

interface Rig { browser: Browser; page: Page; cdp: CDPSession }

interface TraceEvent { name: string; ph: string; dur?: number; args?: { elementCount?: number } }

/**
 * Runs `act` (one press) and measures it: resets the probe, arms the watch,
 * acts, waits until the page has settled, then reads the probe and the main
 * thread's counters. With `trace`, a `devtools.timeline` trace runs around
 * it for the style recalcs' element counts.
 */
async function measure(rig: Rig, act: () => Promise<void>, { watch, trace = false, idle = 150 }: { watch?: Watch; trace?: boolean | string; idle?: number } = {}): Promise<Sample> {
  const { page, cdp, browser } = rig
  await page.evaluate(() => window.__perf!.reset())
  if (trace) await browser.startTracing(page, { categories: TRACE_CATEGORIES })
  const before = await metrics(cdp)
  if (watch) await page.evaluate(({ selector, mode }) => window.__perf!.arm(selector, mode), { selector: watch.selector, mode: watch.mode ?? 'present' })
  await act()
  await page.evaluate(() => window.__perf!.settled())
  await page.waitForTimeout(idle)
  const after = await metrics(cdp)
  let recalc: Pick<Sample, 'maxElements' | 'maxRecalcMs' | 'elements' | 'recalcMs'> = {}
  if (trace) {
    const raw = await browser.stopTracing()
    if (TRACE_DIR !== '' && typeof trace === 'string') {
      mkdirSync(TRACE_DIR, { recursive: true })
      writeFileSync(join(TRACE_DIR, `${trace}.json`), raw)
    }
    const events = (JSON.parse(raw.toString('utf8')) as { traceEvents: TraceEvent[] }).traceEvents
    const recalcs = events.filter((e) => e.name === 'UpdateLayoutTree' && e.ph === 'X')
    const counts = recalcs.map((e) => e.args?.elementCount ?? 0)
    const largest = recalcs.reduce<TraceEvent | undefined>((a, e) => ((e.args?.elementCount ?? 0) > (a?.args?.elementCount ?? -1) ? e : a), undefined)
    recalc = {
      maxElements: Math.max(0, ...counts),
      maxRecalcMs: Math.round((largest?.dur ?? 0) / 100) / 10,
      elements: counts.reduce((a, b) => a + b, 0),
      recalcMs: Math.round(recalcs.reduce((a, e) => a + (e.dur ?? 0), 0) / 100) / 10,
    }
  }
  const probe = await page.evaluate(() => {
    const p = window.__perf!
    p.flush()
    return { presses: p.presses, vt: p.vt, frames: p.frames, events: p.events, watch: p.watch, react: p.react }
  })
  const press = probe.presses[0]?.at ?? null
  const since = (t: number | undefined) => (press != null && t != null ? Math.round(t - press) : null)
  const vt = probe.vt.filter((v) => !v.skipped)
  const lastVt = vt.at(-1)
  const watched = since(probe.watch?.shown)
  const vtShown = since(lastVt?.shown)
  const shown = watched != null && vtShown != null ? Math.max(watched, vtShown) : watched ?? vtShown
  const finished = since(lastVt?.finished)
  const frames = press != null ? probe.frames.filter((f) => f.start + f.duration >= press) : []
  const events = press != null ? probe.events.filter((e) => e.start >= press - 1) : []
  return {
    shown,
    settled: finished != null ? Math.max(finished, shown ?? 0) : shown,
    event: events.length > 0 ? Math.max(...events.map((e) => e.duration)) : null,
    script: Math.round(after.script - before.script),
    style: Math.round(after.style - before.style),
    layout: Math.round(after.layout - before.layout),
    styleCount: after.styleCount - before.styleCount,
    layoutCount: after.layoutCount - before.layoutCount,
    longest: Math.round(Math.max(0, ...frames.map((f) => f.duration))),
    longSum: Math.round(frames.reduce((a, f) => a + f.duration, 0)),
    vtUpdate: lastVt?.updated != null ? Math.round(lastVt.updated - lastVt.start) : null,
    vtAnim: lastVt?.finished != null && lastVt.ready != null ? Math.round(lastVt.finished - lastVt.ready) : null,
    vtStart: since(lastVt?.start),
    commits: probe.react.commits,
    renders: probe.react.renders,
    mounts: probe.react.mounts,
    ...recalc,
  }
}

// --- Results --------------------------------------------------------------

type Stat = { median: number; min: number; max: number; n: number }

function stat(values: Array<number | null | undefined>): Stat | null {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b)
  if (v.length === 0) return null
  return { median: v[Math.floor(v.length / 2)]!, min: v[0]!, max: v[v.length - 1]!, n: v.length }
}

const show = (s: Stat | null) => (s ? `${s.median} (${s.min}–${s.max})` : '–')

const NUMERIC = ['shown', 'settled', 'event', 'script', 'style', 'layout', 'styleCount', 'layoutCount', 'longest', 'longSum', 'vtUpdate', 'vtAnim', 'vtStart', 'commits', 'renders', 'mounts', 'maxElements', 'maxRecalcMs', 'elements', 'recalcMs'] as const

interface Results {
  meta: Record<string, unknown>
  scenarios: Record<string, { samples: Sample[]; summary: Partial<Record<(typeof NUMERIC)[number], Stat>> }>
  presses: Record<string, { landed: number; of: number; targets: string[] }>
}

const results: Results = { meta: {}, scenarios: {}, presses: {} }

/** Keeps `samples` (the warm-up already dropped) under `name`. */
function record(name: string, samples: Sample[]): void {
  const summary: Partial<Record<(typeof NUMERIC)[number], Stat>> = {}
  for (const key of NUMERIC) {
    const s = stat(samples.map((x) => x[key]))
    if (s) summary[key] = s
  }
  results.scenarios[name] = { samples, summary }
}

/** `once` run `RUNS` + 1 times, the first dropped. */
async function repeat(name: string, once: (i: number) => Promise<Sample>): Promise<void> {
  const samples: Sample[] = []
  for (let i = 0; i <= RUNS; i++) {
    const sample = await once(i)
    if (i > 0) samples.push(sample)
  }
  record(name, samples)
}

function report(): string {
  const lines: string[] = []
  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
  lines.push(`${pad('scenario', 34)}${pad('shown', 16)}${pad('settled', 16)}${pad('event', 16)}${pad('script', 14)}${pad('style', 14)}${pad('layout', 14)}${pad('longest', 16)}${pad('vt update', 14)}${pad('max elements', 20)}`)
  for (const [name, { summary: s }] of Object.entries(results.scenarios)) {
    lines.push(`${pad(name, 34)}${pad(show(s.shown ?? null), 16)}${pad(show(s.settled ?? null), 16)}${pad(show(s.event ?? null), 16)}${pad(show(s.script ?? null), 14)}${pad(show(s.style ?? null), 14)}${pad(show(s.layout ?? null), 14)}${pad(show(s.longest ?? null), 16)}${pad(show(s.vtUpdate ?? null), 14)}${pad(show(s.maxElements ?? null), 20)}`)
  }
  for (const [name, p] of Object.entries(results.presses)) lines.push(`${pad(name, 34)}landed ${p.landed} of ${p.of}   (targets: ${p.targets.join(', ')})`)
  return lines.join('\n')
}

// --- The page ---------------------------------------------------------------

const cellSel = (id: string) => `[data-ws-cell="${id}"]`
const rowsIn = (cell: string) => `${cellSel(cell)} [data-todo-id]`

async function centre(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`nothing at ${selector}`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

/** Frames are being drawn: this machine's Chromium draws none for a while after launch. */
async function waitForFrames(page: Page): Promise<number> {
  const started = Date.now()
  await page.evaluate(() => new Promise<void>((done) => {
    let n = 0
    const tick = () => { if (++n >= 30) done(); else requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  }))
  return Date.now() - started
}

/**
 * A click sent straight to the browser's input queue, not waiting for the
 * page to answer each step (Playwright's own click waits for the pointer
 * move's answer, which a busy page delays): the press is made now, and
 * reaches the page when it next takes input — as a person's does.
 */
function rawClick(cdp: CDPSession, x: number, y: number): Promise<unknown> {
  const at = { x, y, button: 'left' as const, clickCount: 1 }
  return Promise.all([
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
    cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, buttons: 1 }),
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at }),
  ])
}

async function settle(page: Page, ms = 400): Promise<void> {
  await page.evaluate(() => window.__perf!.settled())
  await page.waitForTimeout(ms)
}

test('the built offline file at about 145 tasks and seven cells', async ({ playwright }) => {
  test.setTimeout(1_800_000)
  expect(existsSync(FILE), `${FILE}: run "npm run build" first`).toBe(true)
  expect(existsSync(SEED), `${SEED}: run "npm run seed:dev" first`).toBe(true)
  const work = mkdtempSync(join(tmpdir(), 'todo2-perf-'))
  const seedFile = join(work, 'perf-seed.json')
  writeFileSync(seedFile, perfSeed())

  const browser = await playwright.chromium.launch({ headless: true, args: GPU_ARGS })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: REDUCED ? 'reduce' : 'no-preference' })
    const page = await context.newPage()
    // No File System Access pickers: the import goes through the file input.
    await page.addInitScript(() => {
      for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
        delete (Window.prototype as unknown as Record<string, unknown>)[name]
        delete (window as unknown as Record<string, unknown>)[name]
      }
    })
    await page.addInitScript(installProbe)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const rig: Rig = { browser, page, cdp }

    await page.goto(pathToFileURL(FILE).href)
    await expect(page.locator('[data-ws-area]')).toBeVisible({ timeout: 300_000 })
    say('the page is up; waiting for frames')
    const firstFramesAfterMs = await waitForFrames(page)
    say(`frames after ${firstFramesAfterMs} ms; importing the seed`)

    // The data, through Settings › Import / Export › Import JSON.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Database', exact: true }).click()
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), settings.getByRole('button', { name: 'Import JSON' }).click()])
    await chooser.setFiles(seedFile)
    await expect(settings.getByText(/^Imported successfully/)).toBeVisible({ timeout: 120_000 })
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    // From a fresh launch, as the user's file opens.
    await page.reload()
    await expect(page.locator(rowsIn('p7-main')).first()).toBeVisible({ timeout: 120_000 })
    await waitForFrames(page)
    await settle(page, 1500)
    say('seeded and reloaded')

    // An experiment (`PERF_DROP_RULES`): the matching style rules deleted, to see what they cost.
    const droppedRules = DROP_RULES === '' ? [] : await page.evaluate((pattern) => {
      const match = new RegExp(pattern)
      const dropped: string[] = []
      const walk = (owner: CSSStyleSheet | CSSGroupingRule) => {
        for (let i = owner.cssRules.length - 1; i >= 0; i--) {
          const rule = owner.cssRules[i]
          if (rule instanceof CSSStyleRule && match.test(rule.selectorText)) {
            dropped.push(rule.selectorText)
            owner.deleteRule(i)
          } else if (rule instanceof CSSGroupingRule) {
            walk(rule)
          }
        }
      }
      for (const sheet of document.styleSheets) walk(sheet)
      return dropped
    }, DROP_RULES)
    if (ADD_CSS !== '') await page.addStyleTag({ content: ADD_CSS })
    if (DROP_RULES !== '' || ADD_CSS !== '') {
      // An element remembers that a hover or focus rule once looked at it: the cells are mounted
      // afresh (a layout switch away and back), so only the rules left are in play.
      await settle(page, 500)
      for (const [name, cell] of [['Default', 'cell-person'], ['Seven', 'p7-main']] as const) {
        await page.getByTestId('layout-tab').filter({ hasText: new RegExp(`^${name}$`) }).click()
        await expect(page.locator(`[data-ws-cell="${cell}"]`)).toBeVisible({ timeout: 30_000 })
        await settle(page, 500)
      }
    }

    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl')
      const info = gl?.getExtension('WEBGL_debug_renderer_info')
      return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'no WebGL'
    })
    const shape = await page.evaluate(() => ({
      domNodes: document.querySelectorAll('*').length,
      taskRows: document.querySelectorAll('[data-ws-area] [data-todo-id]').length,
      bigListRows: document.querySelectorAll('[data-ws-cell="p7-main"] [data-todo-id]').length,
      cells: document.querySelectorAll('[data-ws-cell]').length,
      animations: document.getAnimations().length,
      layouts: document.querySelectorAll('[data-testid="layout-tab"]').length,
    }))
    results.meta = {
      file: FILE,
      at: new Date().toISOString(),
      runs: RUNS,
      ambience: AMBIENCE,
      reducedMotion: REDUCED,
      gpu,
      userAgent: await page.evaluate(() => navigator.userAgent),
      firstFramesAfterMs,
      droppedRules,
      addedCss: ADD_CSS,
      viewport: '1440x900',
      ...shape,
    }
    expect(shape.cells).toBe(7)
    expect(shape.layouts).toBe(3)

    const layoutTab = (name: string) => page.getByTestId('layout-tab').filter({ hasText: new RegExp(`^${name}$`) })
    const openLayout = async (name: string, cell: string) => {
      await layoutTab(name).click()
      await expect(page.locator(cellSel(cell))).toBeVisible()
      await settle(page)
    }

    // --- A layout switch ---
    if (wants('layout')) {
      say('layout')
      const toDefault: Sample[] = []
      const toSeven: Sample[] = []
      const toPlanning: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        const a = await measure(rig, () => layoutTab('Default').click(), { watch: { selector: `${cellSel('cell-cal')} [data-calendar-widget]` } })
        const b = await measure(rig, () => layoutTab('Seven').click(), { watch: { selector: rowsIn('p7-main') } })
        const c = await measure(rig, () => layoutTab('Planning').click(), { watch: { selector: cellSel('cell-n-late') } })
        await openLayout('Seven', 'p7-main')
        if (i > 0) { toDefault.push(a); toSeven.push(b); toPlanning.push(c) }
      }
      record('layout: Seven → Default (12 cells)', toDefault)
      record('layout: Default → Seven (7 cells)', toSeven)
      record('layout: Seven → Planning', toPlanning)
    }

    // --- A second press soon after a layout-tab click: does it land? ---
    if (wants('press')) {
      say('press')
      const gear = await centre(page, 'button[aria-label="Settings"]')
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      for (const delay of [60, 150, 300]) {
        let landed = 0
        const targets: string[] = []
        for (let i = 0; i < RUNS; i++) {
          const tab = await layoutTab('Default').boundingBox()
          if (!tab) throw new Error('no Default tab')
          await page.evaluate(() => window.__perf!.reset())
          // Neither click waits for the page: the second goes out `delay` ms after the first, however busy the page is.
          const first = rawClick(cdp, Math.round(tab.x + tab.width / 2), Math.round(tab.y + tab.height / 2))
          await new Promise((done) => setTimeout(done, delay))
          await Promise.all([first, rawClick(cdp, gear.x, gear.y)])
          const opened = await dialog.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false)
          const presses = await page.evaluate(() => window.__perf!.presses.filter((p) => p.type === 'pointerdown'))
          targets.push(`${presses[1]?.target ?? '?'}@${presses[1] && presses[0] ? Math.round(presses[1].at - presses[0].at) : '?'}`)
          if (opened) {
            landed++
            await page.keyboard.press('Escape')
            await expect(dialog).toBeHidden()
          }
          await settle(page)
          await openLayout('Seven', 'p7-main')
        }
        results.presses[`press ${delay} ms after a layout tab`] = { landed, of: RUNS, targets }
      }
    }

    // --- A tab switch in the three-tab cell ---
    if (wants('tab')) {
      say('tab')
      const tab = (id: string) => page.locator(`[data-ws-tab="${id}"]`)
      const toNotes: Sample[] = []
      const fromNotes: Sample[] = []
      const toWeek: Sample[] = []
      const toAll: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        const a = await measure(rig, () => tab('p7-notes').click(), { watch: { selector: `${cellSel('p7-main')} .cm-editor` } })
        const b = await measure(rig, () => tab('p7-all').click(), { watch: { selector: '[data-list-widget="p7-all"] [data-todo-id]' } })
        const c = await measure(rig, () => tab('p7-week').click(), { watch: { selector: '[data-list-widget="p7-week"]' } })
        const d = await measure(rig, () => tab('p7-all').click(), { watch: { selector: '[data-list-widget="p7-all"] [data-todo-id]' } })
        if (i > 0) { toNotes.push(a); fromNotes.push(b); toWeek.push(c); toAll.push(d) }
      }
      record('tab: list (110) → notes', toNotes)
      record('tab: notes → list (110)', fromNotes)
      record('tab: list (110) → list', toWeek)
      record('tab: list → list (110)', toAll)
    }

    // --- The pointer crossing a cell's edge; within the list ---
    if (wants('hover')) {
      say('hover')
      const inList = await centre(page, cellSel('p7-main'))
      const inCalendar = await centre(page, cellSel('p7-cal'))
      await page.mouse.move(inList.x, inList.y)
      await settle(page)
      const out: Sample[] = []
      const back: Sample[] = []
      const rows: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        const a = await measure(rig, () => page.mouse.move(inCalendar.x, inCalendar.y), { trace: `hover-out-${i}` })
        const b = await measure(rig, () => page.mouse.move(inList.x, inList.y), { trace: `hover-back-${i}` })
        // Down five rows inside the list: what a row's own hover costs.
        const c = await measure(rig, async () => {
          for (let step = 1; step <= 5; step++) await page.mouse.move(inList.x, inList.y + step * 30)
          await page.mouse.move(inList.x, inList.y)
        }, { trace: true })
        if (i > 0) { out.push(a); back.push(b); rows.push(c) }
      }
      record('hover: list cell → calendar cell', out)
      record('hover: calendar cell → list cell', back)
      record('hover: five rows inside the list', rows)
    }

    // --- The focus moving into a cell, out of it, to an overlay ---
    if (wants('focus')) {
      say('focus')
      const filter = page.getByRole('textbox', { name: 'Filter tasks' })
      const row = (n: number) => page.locator(rowsIn('p7-main')).nth(n)
      await filter.click()
      await settle(page)
      const into: Sample[] = []
      const outOf: Sample[] = []
      const next: Sample[] = []
      const quickAddOpen: Sample[] = []
      const quickAddClose: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        // A press on a row's title: selects the row, the focus enters the cell.
        const pressRow = (n: number) => row(n).locator('span[data-task-title]').click()
        const a = await measure(rig, () => pressRow(3 + (i % 2)), { trace: `focus-into-${i}` })
        const b = await measure(rig, () => pressRow(6 + (i % 2)), { trace: `focus-next-${i}` })
        const c = await measure(rig, () => page.keyboard.press('Control+Space'), { trace: `quickadd-open-${i}`, watch: { selector: '[role="dialog"][aria-label="Quick add task"]' } })
        const d = await measure(rig, () => page.keyboard.press('Escape'), { trace: `quickadd-close-${i}`, watch: { selector: '[role="dialog"][aria-label="Quick add task"]', mode: 'absent' } })
        const e = await measure(rig, () => filter.click(), { trace: `focus-out-${i}` })
        await page.keyboard.press('Escape')
        await settle(page, 200)
        if (i > 0) { into.push(a); next.push(b); quickAddOpen.push(c); quickAddClose.push(d); outOf.push(e) }
      }
      record('focus: top bar → a list row', into)
      record('focus: the next row', next)
      record('focus: open Quick Add', quickAddOpen)
      record('focus: close Quick Add', quickAddClose)
      record('focus: a list row → top bar', outOf)
    }

    // --- Typing in the top bar's filter ---
    if (wants('type')) {
      say('type')
      const filter = page.getByRole('textbox', { name: 'Filter tasks' })
      await filter.click()
      const keys: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        for (const key of ['r', 'e', 'v']) {
          const s = await measure(rig, () => page.keyboard.press(key), { idle: 100 })
          if (i > 0) keys.push(s)
        }
        await filter.fill('')
        await settle(page, 200)
      }
      record('type: a letter in the filter', keys)
      await page.keyboard.press('Escape')
      await page.mouse.click(5, 450)
      await settle(page)
    }

    // --- Completing a task (then Undo) ---
    if (wants('complete')) {
      say('complete')
      const done: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        const box = page.locator(rowsIn('p7-main')).nth(2).getByRole('checkbox', { name: 'Mark complete' })
        const s = await measure(rig, () => box.click(), { idle: 2200 })
        await page.keyboard.press('Control+z')
        await settle(page, 600)
        if (i > 0) done.push(s)
      }
      record('complete a task (to the fold’s end)', done)
    }

    // --- Open larger: the big list in the widget popup ---
    if (wants('larger')) {
      say('larger')
      const popup = page.getByTestId('widget-popup')
      const larger: Sample[] = []
      const close: Sample[] = []
      for (let i = 0; i <= RUNS; i++) {
        await page.locator(cellSel('p7-main')).hover()
        const button = page.locator(cellSel('p7-main')).getByRole('button', { name: 'Open larger' })
        const a = await measure(rig, () => button.click(), { watch: { selector: '[data-testid="widget-popup"] [data-todo-id]' } })
        await expect(popup).toBeVisible()
        const b = await measure(rig, () => page.keyboard.press('Escape'), { watch: { selector: '[data-testid="widget-popup"]', mode: 'absent' } })
        await expect(popup).toHaveCount(0)
        if (i > 0) { larger.push(a); close.push(b) }
      }
      record('open the big list larger', larger)
      record('close the widget popup', close)
    }

    // --- Adding a widget as a tab: a List, a Number ---
    if (wants('add')) {
      say('add')
      const host = 'p7-trend'
      const openAdd = async () => {
        // The ⋯'s Add widget as tab › (E4).
        await page.locator(cellSel(host)).hover()
        await page.locator(cellSel(host)).getByRole('button', { name: 'Cell options' }).click()
        await page.getByRole('menuitem', { name: 'Add widget as tab' }).click()
        await expect(page.getByRole('menu', { name: 'Add widget as tab' })).toBeVisible()
      }
      const undo = async (gone: string) => {
        await page.keyboard.press('Control+z')
        await expect(page.locator(gone)).toHaveCount(0)
        await settle(page, 500)
      }
      await repeat('add a List (every open task)', async () => {
        await openAdd()
        const s = await measure(rig, () => page.getByRole('menu', { name: 'Add widget as tab' }).getByRole('menuitem', { name: 'List', exact: true }).click(), { watch: { selector: rowsIn(host) }, idle: 400 })
        await undo(rowsIn(host))
        return s
      })
      await repeat('add a Number', async () => {
        await openAdd()
        const s = await measure(rig, () => page.getByRole('menu', { name: 'Add widget as tab' }).getByRole('menuitem', { name: 'Number', exact: true }).click(), { watch: { selector: `${cellSel(host)} [data-number]` }, idle: 400 })
        await undo(`${cellSel(host)} [data-number]`)
        return s
      })
    }

    // --- Nothing pressed for two seconds ---
    if (wants('idle')) {
      say('idle')
      await page.mouse.move(5, 450)
      await settle(page, 500)
      await repeat('idle, 2 s', () => measure(rig, async () => {}, { idle: 2000 }))
    }

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify(results, null, 2))
    console.log(`\n${JSON.stringify(results.meta, null, 1)}\n\n${report()}\n\nwritten to ${OUT}\n`)
  } finally {
    await browser.close()
    rmSync(work, { recursive: true, force: true })
  }
})
