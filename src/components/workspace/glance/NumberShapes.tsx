import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { emptyPredicate } from '../../../models/filter-predicate'
import { numberIsLit } from '../../../models/glance-widgets'
import { DEFAULT_NUMBER_OLDEST_BY, type NumberGroupItem } from '../../../models/number-shapes'
import type { NumberTab } from '../../../models/workspace-layout'
import { useNumberCount, useStatsBase } from '../../../hooks/use-glance-data'
import { useNumberGroup, useNumberList, useNumberOldest, useNumberShare, useShareHistory } from '../../../hooks/use-number-shapes'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { historyDelta } from '../../../services/stats/number-count'
import { goalProgress } from '../../../services/stats/number-shapes'
import type { WidgetFace } from '../../../utils/widget-face'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { useChipNames } from '../../shared/filters/filter-menu'
import { WidgetFacePopover } from '../CellFaceParts'
import { WidgetTopLine } from '../WidgetTopLine'
import { approximateNote, countOf, numberDescription } from './glance-copy'
import { numberDrill } from './glance-drills'
import { glanceDrill, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import { GlanceFrame } from './GlanceFrame'
import { litColors, numberColors, type NumberColors } from './number-colors'
import {
  goalStateLabel,
  goalTargetLabel,
  oldestAge,
  oldestFoot,
  OLDEST_BY_WORDS,
  paceLabel,
  percentLabel,
  shareDeltaLabel,
  shareOfLabel,
} from './number-shape-copy'
import { NumberLine } from './NumberLine'
import { Sparkline } from './Sparkline'
import base from './NumberWidget.module.css'
import styles from './NumberShapes.module.css'

/**
 * A Number's other shapes (D26 P6, board Y) — Share of…, Oldest, Against a
 * goal, a group of counts, Follow a list —, each its own widget over its
 * own data (`hooks/use-number-shapes`). Every one keeps the Number's frame:
 * its body (`data-number-body`, where its editor opens), its label as its
 * top line, a click on it opening its tasks (a group's on each count; a
 * list's opening the list over the cell); its small face is its label and
 * its number.
 */

type ShapeProps = GlanceWidgetProps<NumberTab>

/** The label every shape keeps: the Number's top line (the cell's controls float over it). */
function Label({ name, color }: { name: string; color: string }) {
  return (
    <WidgetTopLine as="span" controls="cell" className={base.label} style={{ color }}>
      <span className={base.labelText}>{name}</span>
    </WidgetTopLine>
  )
}

/**
 * The Number's frame around a shape's figures: its body, and its label and
 * figures in one button that opens what it stands for (`onOpen`; a plain
 * group without one).
 */
function NumberShell({ tab, face, faceRef, colors, name, ariaLabel, onOpen, bodyRef, children }: {
  tab: NumberTab
  face: WidgetFace
  faceRef: (el: HTMLElement | null) => void
  colors: NumberColors
  name: string
  ariaLabel: string
  onOpen?: () => void
  bodyRef?: (el: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const large = face === 'large'
  const common = {
    className: `${base.number} ${styles.shape}${large ? ` ${base.large} ${styles.large}` : ''}${face === 'small' ? ` ${styles.small}` : ''}`,
    'data-number': tab.id,
    'data-show': tab.config.show,
    'data-lit': colors.lit ? 'true' : undefined,
  }
  const content = (
    <>
      <Label name={name} color={colors.label} />
      {children}
    </>
  )
  const open = (e: MouseEvent) => {
    // Its own drill: not the cell's full-widget popover.
    e.preventDefault()
    onOpen?.()
  }
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      <div ref={bodyRef} data-number-body={tab.id} className={base.body}>
        {onOpen ? (
          <button type="button" {...common} aria-label={`${ariaLabel} Show tasks`} onClick={open}>{content}</button>
        ) : (
          <div {...common} role="group" aria-label={ariaLabel}>{content}</div>
        )}
      </div>
    </GlanceFrame>
  )
}

/** The Number's name, or `Number` while it is blank. */
function nameOf(tab: NumberTab, fallback = 'Number'): string {
  return tab.config.name.trim() || fallback
}

// ── Share of… ───────────────────────────────────────────────────────────────

/** A ring filled to `percent`. */
function Ring({ percent, color, size }: { percent: number | null; color: string; size: number }) {
  const stroke = Math.max(5, Math.round(size / 9))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const filled = ((percent ?? 0) / 100) * c
  return (
    <span className={styles.ring} style={{ width: size, height: size }} aria-hidden="true" data-testid="number-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-tint-8)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${filled} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </span>
  )
}

/** A share's line of percents and its change in points: items of the wrapping line around it (`.figures`, `.shareLine`), so each drops out alone where it doesn't fit. */
function ShareHistory({ history, large, color, deltaText, approximate }: {
  history: { series: readonly number[] }
  large: boolean
  /** The line's colour (`NumberColors.line`). */
  color: string
  deltaText: string | null
  approximate: string | null
}) {
  return (
    <>
      <NumberLine approximate={approximate}>
        <Sparkline series={history.series} width={large ? 96 : 56} height={large ? 30 : 20} color={color} />
      </NumberLine>
      {deltaText != null && <span className={base.delta} data-testid="number-delta">{deltaText}</span>}
    </>
  )
}

/**
 * Share of… (board Y): the tasks its filter keeps as a share of the ones a
 * second filter keeps (every open task by default) — a ring, the percent and
 * `N of M`, its 14-day line of percents and its change in points. Lit by
 * its percent (`litWhen` / `litAt`).
 */
export function ShareNumber({ tab, onResult, onDrill }: ShapeProps) {
  const config = tab.config
  const stats = useStatsBase()
  const data = useNumberShare(stats, config)
  const history = useShareHistory(stats, data)
  const names = useChipNames()
  const [faceRef, face] = useWidgetFace()
  const name = nameOf(tab)
  const { percent, ids, of } = data.share
  const colors = percent == null ? litColors(config, false, true) : numberColors(config, percent)
  const small = face === 'small'
  const large = face === 'large'
  const percentText = percentLabel(percent)
  const ofText = shareOfLabel(ids.length, of)
  const delta = history && config.compare !== 'none' ? historyDelta(history.series, config.compare) : null
  const deltaText = delta == null || config.compare === 'none' ? null : shareDeltaLabel(delta, config.compare, stats.ctx.today)
  const approximate = history != null && !history.exactness.exact ? approximateNote(history.exactness.approximate) : null

  const lines = useMemo(() => [[{ label: name, count: percentText }], [{ label: ofText, count: '' }]], [name, percentText, ofText])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, data.count.filtered)
  const ofWords = numberDescription(config.of ?? emptyPredicate(), names)
  const open = drill && (() => drill(numberDrill(name, `${numberDescription(config.filter, names)} Out of: ${ofWords}`, ids)))
  return (
    <NumberShell
      tab={tab}
      face={face}
      faceRef={faceRef}
      colors={colors}
      name={name}
      ariaLabel={`${name}: ${percentText}, ${ofText}.${deltaText ? ` ${approximate ? 'About ' : ''}${deltaText}.` : ''}`}
      onOpen={open}
    >
      {small ? (
        // A fit row's: the percent, its line and its change beside it wherever they fit (`.figures`).
        <span className={base.figures}>
          <span className={base.count} style={{ color: colors.count }} data-testid="number-count">{percentText}</span>
          {history && <ShareHistory history={history} large={false} color={colors.line} deltaText={deltaText} approximate={approximate} />}
        </span>
      ) : (
        <span className={styles.shareRow}>
          <Ring percent={percent} color={colors.lit ? colors.count : 'var(--color-text-secondary)'} size={large ? 72 : 44} />
          <span className={styles.column}>
            <span className={base.count} style={{ color: colors.count }} data-testid="number-count">{percentText}</span>
            <span className={styles.meta} data-testid="number-share-of">{ofText}</span>
            {history && (
              <span className={`${styles.shareLine}${large ? ` ${styles.shareLineLarge}` : ''}`}>
                <ShareHistory history={history} large={large} color={colors.line} deltaText={deltaText} approximate={approximate} />
              </span>
            )}
          </span>
        </span>
      )}
    </NumberShell>
  )
}

// ── Oldest ──────────────────────────────────────────────────────────────────

/**
 * Oldest (board Y): the age in days of the stalest task its filter keeps,
 * by its date (last follow-up, created, modified or due), that task's
 * title, and `N · median D days`. Lit by the age (`litWhen` / `litAt`); a
 * click opens its tasks, oldest first.
 */
export function OldestNumber({ tab, onResult, onDrill }: ShapeProps) {
  const config = tab.config
  const by = config.oldestBy ?? DEFAULT_NUMBER_OLDEST_BY
  const stats = useStatsBase()
  const { count, oldest } = useNumberOldest(stats, config)
  const names = useChipNames()
  const [faceRef, face] = useWidgetFace()
  const name = nameOf(tab)
  const top = oldest.oldest
  const age = top ? oldestAge(top.days, by) : null
  const colors = top ? litColors(config, numberIsLit(config, top.days), false) : litColors(config, false, true)
  const total = count.ids.shown.length
  const foot = oldestFoot(total, oldest.median)
  const small = face === 'small'

  const lines = useMemo(() => [
    [{ label: name, count: age ? `${age.figure} ${age.caption}` : 'No tasks' }],
    ...(top ? [[{ label: top.title, count: '' }]] : []),
    [{ label: foot, count: '' }],
  ], [name, age, top, foot])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, count.filtered)
  const open = drill && (() => drill(numberDrill(name, `${numberDescription(config.filter, names)} Oldest first by ${OLDEST_BY_WORDS[by]}.`, oldest.ids)))
  return (
    <NumberShell
      tab={tab}
      face={face}
      faceRef={faceRef}
      colors={colors}
      name={name}
      ariaLabel={age && top ? `${name}: ${age.figure} ${age.caption}, ${top.title}. ${foot}.` : `${name}: no tasks.`}
      onOpen={open}
    >
      <span className={styles.figureLine}>
        <span className={base.count} style={{ color: colors.count }} data-testid="number-count">{age ? age.figure : '—'}</span>
        {!small && <span className={styles.caption}>{age ? age.caption : 'No tasks'}</span>}
      </span>
      {!small && top && <span className={styles.title} data-testid="number-oldest-title">{top.title}</span>}
      {!small && <span className={styles.meta} data-testid="number-oldest-foot">{foot}</span>}
    </NumberShell>
  )
}

// ── Against a goal ──────────────────────────────────────────────────────────

/**
 * Against a goal (board Y): its count over its goal — at most or at least
 * N, a week's pace marked by a tick — on a bar, and where it stands. Lit
 * while an at-least goal is behind its pace (or, without one, not met) and
 * while an at-most one is over its limit.
 */
export function GoalNumber({ tab, onResult, onDrill }: ShapeProps) {
  const config = tab.config
  const stats = useStatsBase()
  const count = useNumberCount(stats, config)
  const names = useChipNames()
  const [faceRef, face] = useWidgetFace()
  const name = nameOf(tab)
  const n = count.ids.shown.length
  const goal = config.goal
  const progress = goal ? goalProgress(n, goal, stats.ctx.today, stats.ctx.weekStartsOn) : null
  const colors = litColors(config, progress?.lit === true, n === 0 && !progress?.lit)
  const state = progress ? goalStateLabel(progress, n, stats.ctx.today) : 'No goal'
  const target = progress ? goalTargetLabel(progress.target) : ''
  const small = face === 'small'

  const lines = useMemo(() => [[{ label: name, count: `${n} ${target}`.trim() }], [{ label: state, count: '' }]], [name, n, target, state])
  useReportLines(onResult, lines)

  const drill = glanceDrill(onDrill, count.filtered)
  const open = drill && (() => drill(numberDrill(name, numberDescription(config.filter, names), count.ids.shown)))
  return (
    <NumberShell
      tab={tab}
      face={face}
      faceRef={faceRef}
      colors={colors}
      name={name}
      ariaLabel={`${name}: ${n} ${target}, ${state}.`}
      onOpen={open}
    >
      <span className={styles.figureLine}>
        <span className={base.count} style={{ color: colors.count }} data-testid="number-count">{n}</span>
        {progress && <span className={styles.target} data-testid="number-goal-target">{target}</span>}
        {!small && <span className={`${styles.state}${progress?.lit ? ` ${styles.stateLit}` : ''}`} style={progress?.lit ? { color: colors.count } : undefined} data-testid="number-goal-state">{state}</span>}
      </span>
      {!small && progress && (
        <span className={styles.bar} data-testid="number-goal-bar" data-goal-state={progress.state}>
          <span className={styles.fill} style={{ width: `${Math.round(progress.fraction * 100)}%`, background: progress.lit ? colors.count : 'var(--color-text-secondary)' }} />
          {progress.pace != null && progress.paceFraction != null && (
            <span
              className={styles.tick}
              style={{ left: `${Math.min(100, Math.round(progress.paceFraction * 100))}%` }}
              title={paceLabel(progress.pace, stats.ctx.today)}
              data-testid="number-goal-pace"
            />
          )}
        </span>
      )}
    </NumberShell>
  )
}

// ── Group ───────────────────────────────────────────────────────────────────

const NO_ITEMS: readonly NumberGroupItem[] = []

/**
 * A group (board Y): up to six counts side by side in one cell, each its
 * own name, filter and colour — lit by the group's `litWhen` / `litAt`, in
 * its own colour —, each opening its tasks. The small face is the label and
 * the counts.
 */
export function GroupNumber({ tab, onResult, onDrill }: ShapeProps) {
  const config = tab.config
  const stats = useStatsBase()
  const counts = useNumberGroup(stats, config)
  const names = useChipNames()
  const [faceRef, face] = useWidgetFace()
  const name = nameOf(tab)
  const items = config.items ?? NO_ITEMS
  const small = face === 'small'
  const large = face === 'large'
  const anyLit = counts.some((c) => numberIsLit(config, c.ids.shown.length))
  const labelColor = 'var(--color-text-muted)'

  const lines = useMemo(() => [
    [{ label: name, count: '' }],
    items.map((item, i) => ({ label: item.name.trim() || 'Number', count: countOf(counts[i]?.ids.shown.length ?? 0, counts[i]?.ids.total.length ?? 0) })),
  ], [name, items, counts])
  useReportLines(onResult, lines)

  const filtered = counts.some((c) => c.filtered)
  const drill = glanceDrill(onDrill, filtered)
  const words = items.map((item, i) => `${item.name.trim() || 'Number'} ${counts[i]?.ids.shown.length ?? 0}`).join(', ')
  return (
    <GlanceFrame tab={tab} faceRef={faceRef} face={face}>
      <div data-number-body={tab.id} className={base.body}>
        <div
          className={`${styles.group}${large ? ` ${styles.groupLarge}` : ''}${small ? ` ${styles.small}` : ''}`}
          role="group"
          aria-label={`${name}: ${words}.`}
          data-number={tab.id}
          data-show="group"
          data-lit={anyLit ? 'true' : undefined}
        >
          <Label name={name} color={labelColor} />
          <span className={styles.items} style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}>
            {items.map((item, i) => {
              const count = counts[i]
              const n = count?.ids.shown.length ?? 0
              const itemName = item.name.trim() || 'Number'
              const colors = litColors({ color: item.color }, numberIsLit(config, n), n === 0)
              const figure = (
                <>
                  <span className={styles.itemCount} style={{ color: colors.count }} data-testid="number-group-count">{n}</span>
                  {!small && <span className={styles.itemName}>{itemName}</span>}
                </>
              )
              const label = `${itemName}: ${n}`
              return drill ? (
                <button
                  key={i}
                  type="button"
                  className={styles.item}
                  title={small ? itemName : undefined}
                  data-group-item={i}
                  data-lit={colors.lit ? 'true' : undefined}
                  aria-label={`${label}. Show tasks`}
                  onClick={(e) => {
                    e.preventDefault()
                    if (count) drill(numberDrill(`${name} · ${itemName}`, numberDescription(item.filter, names), count.ids.shown))
                  }}
                >
                  {figure}
                </button>
              ) : (
                <span key={i} className={styles.item} title={small ? itemName : undefined} data-group-item={i} data-lit={colors.lit ? 'true' : undefined} aria-label={label}>{figure}</span>
              )
            })}
          </span>
        </div>
      </div>
    </GlanceFrame>
  )
}

// ── Follow a list ───────────────────────────────────────────────────────────

/**
 * Follow a list (board Y): what one of the layout's lists shows — its
 * filter as edited, its own lens switch, its prompt and the screen filter
 * (`use-built-list`) — as a count, with its tab badge. A click opens the
 * list over the cell (the small face's popover); its prompt is answered
 * there. Lit by its count (`litWhen` / `litAt`).
 */
export function ListNumber({ tab, onResult }: ShapeProps) {
  const config = tab.config
  const list = useNumberList(tab.id, config.list?.listDefinitionId)
  const [faceRef, face] = useWidgetFace()
  const name = nameOf(tab, list.name ?? 'Number')
  const n = list.ids.length
  const colors = list.pending || !list.lensTab ? litColors(config, false, true) : numberColors(config, n)
  const countText = list.pending || !list.lensTab ? '—' : String(n)
  const ofText = !list.pending && list.lensTab && n < list.baseCount ? `of ${list.baseCount}` : null
  const note = !list.lensTab
    ? (config.list ? 'This list was deleted' : 'No list picked')
    : list.pending ? 'Pick to count' : null
  const [open, setOpen] = useState(false)
  const bodyEl = useRef<HTMLDivElement | null>(null)

  const lines = useMemo(() => [[{ label: name, count: ofText ? `${countText} ${ofText}` : countText }]], [name, countText, ofText])
  useReportLines(onResult, lines)

  return (
    <>
      <NumberShell
        tab={tab}
        face={face}
        faceRef={faceRef}
        colors={colors}
        name={name}
        ariaLabel={`${name}: ${countText}${ofText ? ` ${ofText}` : ''}${list.badge ? `, ${list.badge.summary.join(', ')}` : ''}${note ? `. ${note}` : ''}.`}
        onOpen={list.lensTab ? () => setOpen((v) => !v) : undefined}
        bodyRef={(el) => { bodyEl.current = el }}
      >
        <span className={styles.figureLine}>
          <span className={base.count} style={{ color: colors.count }} data-testid="number-count">
            {countText}
            {ofText && <span className={base.of}>{ofText}</span>}
          </span>
          {list.badge && <BadgeCapsule counts={list.badge.counts} label={list.badge.summary.join(', ')} data-number-badge="" />}
        </span>
        {note && face !== 'small' && <span className={styles.meta} data-testid="number-list-note">{note}</span>}
      </NumberShell>
      {open && list.lensTab && <WidgetFacePopover tab={list.lensTab} anchorRef={bodyEl} onClose={() => setOpen(false)} />}
    </>
  )
}
