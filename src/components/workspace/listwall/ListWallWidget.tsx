import { memo, type CSSProperties } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { ListWallTab } from '../../../models/workspace-layout'
import { useElementSize } from '../../../hooks/use-element-size'
import { useListWall } from '../../../hooks/use-list-wall'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { showTab } from '../../../services/workspace-tabs'
import { useUIStore } from '../../../stores/ui-store'
import { TODO_ID_ATTR } from '../../../utils/dom-contract'
import {
  WALL_TONE_NAMES,
  WALL_TONES,
  wallListWords,
  wallRowsFit,
  wallSquaresShown,
  type WallList,
  type WallTone,
} from '../../../utils/list-wall'
import { listWallFaceFor, type WidgetFace } from '../../../utils/widget-face'
import { HelpTip } from '../../shared/HelpTip'
import { useTooltip } from '../../shared/use-tooltip'
import { WidgetNameLine } from '../WidgetTopLine'
import styles from './ListWallWidget.module.css'

type List = WallList<PersistedTodoItem>

/** How to read the wall: the name line's ⓘ. */
const WALL_HELP = 'A square for each open task a list shows, the trouble first: solid magenta overdue, a magenta outline due soon, yellow follow-up late, tinted on track, gray stale. A list’s name shows its tab in its cell; a square opens its task.'

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** A list's counts in words, for its tooltip and accessible name. */
function countsText(list: List): string {
  return WALL_TONES.filter((t) => list.counts[t] > 0).map((t) => `${list.counts[t]} ${WALL_TONE_NAMES[t].toLowerCase()}`).join(' · ') || 'no open tasks'
}

/**
 * The List wall (task maps, 2026-11-18; widget kind `listwall`, no
 * settings): every list tab of this layout at a glance, without opening
 * each (`hooks/use-list-wall`). Large: a block per list, a square per open
 * task it shows, the trouble first — overdue, due soon, follow-up late, on
 * track, stale (`utils/list-wall`); a big list stops at six rows with `+N`,
 * and in a short cell its block trades rows for columns, so a wide strip
 * shows the lists side by side (`wallGridShape`). Medium (a narrow cell): a bar per list in the same colors, its
 * overdue and late follow-ups in the tab badge's capsule. A list's name (a
 * bar) brings its tab to the front of its cell (`showTab`); a square opens
 * its task.
 */
export function ListWallWidget({ tab }: { tab: ListWallTab }) {
  const [faceRef, face] = useWidgetFace(listWallFaceFor)
  return (
    <div ref={faceRef} className={styles.faceHost} data-list-wall={tab.id}>
      <ListWallFace face={face} />
    </div>
  )
}

function ListWallFace({ face }: { face: WidgetFace }) {
  const lists = useListWall()
  if (face === 'small') {
    const late = lists.reduce((n, l) => n + l.counts.late, 0)
    const withLate = lists.filter((l) => l.counts.late > 0).length
    return (
      <div className={styles.smallFace} role="group" aria-label={`Overdue: ${late} in ${plural(withLate, 'list')}`} data-list-wall-face="small">
        <span className={styles.smallTitle}>Overdue</span>
        <span className={styles.smallFigures}>
          <span className={styles.smallCount} data-lit={late > 0 ? 'true' : undefined} data-testid="list-wall-face-count">{late}</span>
          <span className={styles.smallCaption}>in {plural(withLate, 'list')}</span>
        </span>
      </div>
    )
  }
  return (
    <>
      <WidgetNameLine name="List wall">
        <span className={styles.lineCount}>{plural(lists.length, 'list')}</span>
        <HelpTip label="List wall" text={WALL_HELP} />
      </WidgetNameLine>
      {lists.length === 0
        ? <p className={styles.empty} role="status">No list tabs in this layout.</p>
        : face === 'medium' ? <Bars lists={lists} /> : <Blocks lists={lists} />}
    </>
  )
}

// ── Large: blocks of squares ──────────────────────────────────────────────

function Blocks({ lists }: { lists: List[] }) {
  const [wallRef, wall] = useElementSize()
  // Unmeasured: room for every row.
  const rowsFit = wall.height > 0 ? wallRowsFit(wall.height) : Number.POSITIVE_INFINITY
  return (
    <div ref={wallRef} className={styles.wall} data-list-wall-face="large">
      <div className={styles.blocks}>
        {lists.map((l) => <Block key={l.tabId} list={l} rowsFit={rowsFit} />)}
      </div>
    </div>
  )
}

function Block({ list, rowsFit }: { list: List; rowsFit: number }) {
  const { late, followup, calm } = wallListWords(list.counts)
  const { squares, more, columns } = wallSquaresShown(list, rowsFit)
  const { triggerProps, tooltip } = useTooltip(`${list.name}\n${list.waiting ? 'Waits on its prompt' : countsText(list)}\nClick to show it in its cell`)
  return (
    <section className={styles.block} style={{ '--wall-columns': columns } as CSSProperties} aria-label={list.name} data-wall-list={list.tabId}>
      <button
        type="button"
        className={styles.blockHead}
        data-showing={list.showing ? 'true' : undefined}
        aria-label={`${list.name}: ${list.waiting ? 'waits on its prompt' : countsText(list)}. Show it in its cell`}
        {...triggerProps}
        onClick={() => showTab(list.tabId)}
      >
        <span className={styles.showingDot} aria-hidden="true" />
        <span className={styles.blockName}>{list.name}</span>
        {!list.waiting && <span className={styles.blockCount}>{list.squares.length}</span>}
        {tooltip}
      </button>
      {list.waiting ? (
        <button type="button" className={styles.waiting} onClick={() => showTab(list.tabId)}>
          <span>Waits on its prompt</span>
          <span className={styles.waitingPick}>Pick…</span>
        </button>
      ) : (
        <>
          <div className={styles.blockWords}>
            <span className={styles.wordsLate}>{late}</span>
            {late && followup && <span className={styles.wordsSep}> · </span>}
            <span className={styles.wordsFollowup}>{followup}</span>
            <span className={styles.wordsCalm}>{calm}</span>
          </div>
          {list.squares.length > 0 && (
            <div className={styles.grid} role="group" aria-label={`${list.name}: its tasks`}>
              {squares.map((sq) => <Square key={sq.task.id} task={sq.task} tone={sq.tone} />)}
              {more > 0 && <span className={styles.more} aria-label={`${more} more`}>+{more}</span>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** A task's square: its tooltip its title and state; a click opens it. Memoized: plain props. */
const Square = memo(function Square({ task, tone }: { task: PersistedTodoItem; tone: WallTone }) {
  const { triggerProps, tooltip } = useTooltip(`${task.title}\n${WALL_TONE_NAMES[tone]}`)
  return (
    <button
      type="button"
      className={styles.square}
      data-tone={tone}
      data-focus={task.focus === true ? 'true' : undefined}
      aria-label={`${task.title}: ${WALL_TONE_NAMES[tone]}`}
      {...{ [TODO_ID_ATTR]: task.id }}
      {...triggerProps}
      onClick={() => useUIStore.getState().openEditPopup(task.id)}
    >
      {tooltip}
    </button>
  )
})

// ── Medium: a bar per list ────────────────────────────────────────────────

function Bars({ lists }: { lists: List[] }) {
  const max = Math.max(1, ...lists.map((l) => l.squares.length))
  return (
    <div className={styles.bars} data-list-wall-face="medium">
      {lists.map((l) => <Bar key={l.tabId} list={l} max={max} />)}
    </div>
  )
}

function Bar({ list, max }: { list: List; max: number }) {
  const { triggerProps, tooltip } = useTooltip(`${list.name}\n${list.waiting ? 'Waits on its prompt' : countsText(list)}\nClick to show it in its cell`)
  const total = list.squares.length
  // Its length against the biggest list's (square root, so a small list still reads).
  const width = `${Math.max(12, Math.round(Math.sqrt(total / max) * 100))}%`
  return (
    <button
      type="button"
      className={styles.bar}
      data-showing={list.showing ? 'true' : undefined}
      data-wall-list={list.tabId}
      aria-label={`${list.name}: ${list.waiting ? 'waits on its prompt' : countsText(list)}. Show it in its cell`}
      {...triggerProps}
      onClick={() => showTab(list.tabId)}
    >
      <span className={styles.barHead}>
        <span className={styles.barName}>{list.name}</span>
        {(list.counts.late > 0 || list.counts.followup > 0) && (
          <span className={styles.capsule} aria-hidden="true">
            {list.counts.late > 0 && <span className={styles.capsuleLate}>{list.counts.late}</span>}
            {list.counts.followup > 0 && <span className={styles.capsuleFollowup}>{list.counts.followup}</span>}
          </span>
        )}
        <span className={styles.barTotal}>{list.waiting ? 'prompt' : total}</span>
      </span>
      {list.waiting ? <span className={styles.barWaiting} aria-hidden="true" /> : (
        <span className={styles.barTrack} style={{ width } as CSSProperties} aria-hidden="true">
          {WALL_TONES.filter((t) => list.counts[t] > 0).map((t) => (
            <span key={t} className={styles.segment} data-tone={t} style={{ flexGrow: list.counts[t] }} />
          ))}
        </span>
      )}
      {tooltip}
    </button>
  )
}
