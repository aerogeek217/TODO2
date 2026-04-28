import { expect, test } from '@playwright/test'
import {
  activeInsertInput,
  projectNode,
  seedCanvasWithProjects,
  selectTaskRowByTitle,
  taskRowByTitle,
  taskRowWrappers,
} from './fixtures/seed'

interface ReclaimEvent {
  run: number
  label: string
  skipped: string | null
  calledFocus: boolean
  landedOnInput: boolean | null
}

/**
 * Phase 2 regression record. The diagnosis vehicle was Chrome DevTools MCP;
 * this spec encodes the same trace through Playwright so future changes to
 * `InsertTrigger`'s focus reclaim schedule can be verified against the
 * pattern Phase 2 captured.
 *
 * Drives 20 Enter-chain handoffs against `?debug-focus=1`, captures the
 * `[focus-trace]` console ladder emitted by `InsertTrigger`, and reports
 * which reclaim label first landed focus on the new input per run. The
 * assertion is intentionally narrow: every run must end with the active
 * `InsertTrigger` input focused. The per-run reclaim-label summary is
 * attached to the test as an annotation so future drift surfaces in CI
 * output without flaking the test.
 */
test('Enter-chain focus-trace ladder (Phase 2 record)', async ({ page }, testInfo) => {
  // Seed canvas first; the helper `goto('/')`s, so we navigate to the
  // debug-focus URL afterwards so the InsertTrigger instrumentation
  // initialises with logging on.
  await seedCanvasWithProjects(page, {
    projects: [{ name: 'P1', tasks: ['seed'] }],
  })
  await page.goto('/?debug-focus=1')
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })
  await projectNode(page, 'P1').waitFor({ state: 'visible' })
  await taskRowByTitle(page, 'seed').waitFor({ state: 'visible' })

  // Capture every `[focus-trace]` console.log into a structured array. We
  // read the second arg (label) and third arg (data payload) via the
  // CDP-backed `JSHandle.jsonValue()` so we get the actual object, not its
  // toString.
  const events: { label: string; data: Record<string, unknown> }[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'log') return
    const args = msg.args()
    if (args.length < 2) return
    void Promise.all([args[0]?.jsonValue(), args[1]?.jsonValue(), args[2]?.jsonValue()]).then(
      ([tag, label, data]) => {
        if (tag !== '[focus-trace]') return
        events.push({
          label: String(label),
          data: (data && typeof data === 'object' ? (data as Record<string, unknown>) : {}),
        })
      },
    ).catch(() => undefined)
  })

  // Open the first InsertTrigger.
  await selectTaskRowByTitle(page, 'seed')
  await page.keyboard.press('Insert')
  await expect(activeInsertInput(page)).toBeFocused()

  // Run 20 Enter-chain handoffs. Each run types `tN`, presses Enter, then
  // waits 400ms — long enough for autoFocus + useLayoutEffect + rAF +
  // t0/t50/t150/t300 + the focusout reclaim window to all complete.
  const N = 20
  for (let i = 1; i <= N; i++) {
    // Run-boundary marker so post-hoc analysis can split events per run.
    await page.evaluate((n) => console.log('[focus-trace]', `===== run ${n} START =====`), i)
    await page.keyboard.type(`t${i}`)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(activeInsertInput(page)).toBeFocused()
    await page.evaluate((n) => console.log('[focus-trace]', `===== run ${n} END =====`), i)
  }

  // 1 seed + 20 chained inserts.
  await expect(taskRowWrappers(page)).toHaveCount(N + 1)

  // Post-process: split events by run boundary and tally which reclaim
  // label landed focus first per run.
  await page.waitForTimeout(200) // let trailing console events flush
  const runs: { run: number; events: { label: string; data: Record<string, unknown> }[] }[] = []
  let current: typeof runs[number] | null = null
  for (const ev of events) {
    const m = ev.label.match(/^===== run (\d+) (START|END) =====$/)
    if (m) {
      const [, n, kind] = m
      if (kind === 'START') current = { run: parseInt(n!, 10), events: [] }
      else if (kind === 'END' && current) {
        runs.push(current)
        current = null
      }
      continue
    }
    if (current) current.events.push(ev)
  }

  const RECLAIM_LABELS = ['rAF', 't0', 't50', 't150', 't300', 'focusout-reclaim'] as const
  const tally: Record<string, number> = {
    autoFocus: 0,
    useLayoutEffect: 0,
    rAF: 0,
    t0: 0,
    t50: 0,
    t150: 0,
    t300: 0,
    'focusout-reclaim': 0,
    none: 0,
  }
  const perRun: ReclaimEvent[] = []
  for (const r of runs) {
    if (r.events.some((e) => e.label === 'mount' && e.data.autoFocusOnNode === true)) {
      tally.autoFocus = (tally.autoFocus ?? 0) + 1
    }
    if (r.events.some((e) => e.label === 'useLayoutEffect' && e.data.landedOnInput === true)) {
      tally.useLayoutEffect = (tally.useLayoutEffect ?? 0) + 1
    }
    const firstLanding = r.events.find(
      (e) =>
        (RECLAIM_LABELS as readonly string[]).includes(e.label) &&
        e.data.calledFocus === true &&
        e.data.landedOnInput === true,
    )
    if (firstLanding) {
      tally[firstLanding.label] = (tally[firstLanding.label] ?? 0) + 1
      perRun.push({
        run: r.run,
        label: firstLanding.label,
        skipped: null,
        calledFocus: true,
        landedOnInput: true,
      })
    } else {
      tally.none += 1
      perRun.push({ run: r.run, label: 'none', skipped: null, calledFocus: false, landedOnInput: null })
    }
  }

  await testInfo.attach('focus-trace-tally.json', {
    body: JSON.stringify({ tally, perRun }, null, 2),
    contentType: 'application/json',
  })

  // Sanity check: every run ended with the new input focused. This is the
  // regression bar — if this fails, focus is leaking again.
  expect(perRun.length).toBe(N)
})
