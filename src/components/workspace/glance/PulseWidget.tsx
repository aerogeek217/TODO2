import { useMemo, type CSSProperties } from 'react'
import type { PulseTab } from '../../../models/workspace-layout'
import { usePulse, useStatsBase } from '../../../hooks/use-glance-data'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { cumulative, lateShareText, momentumText, worstPulseCard, type PulseCard } from '../../../services/stats/pulse'
import { tagRowDrill } from './glance-drills'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { Empty, Panel, type PanelDef } from './section-parts'
import styles from './BriefWidgets.module.css'

const PULSE_DEF: PanelDef = { id: 'pulse', title: 'Project pulse', glyph: 'tag', glyphColor: 'var(--color-accent)' }

/** `21 open · 5 late (24%) · 4 stale`. */
function countsText(card: PulseCard): string {
  const late = card.lateIds.length
  return `${card.openIds.length} open · ${late} late${late > 0 ? ` (${lateShareText(card.lateShare)})` : ''} · ${card.staleCount} stale`
}

/** The widget's lines for Copy: a card each, `#tag 21 open · 5 late (24%) · 4 stale · Growing: +5 net in 4 weeks`. */
function pulseLines(cards: readonly PulseCard[]): SummaryPart[][] {
  return cards.map((c) => [{ label: `#${c.tag.name}`, count: `${countsText(c)} · ${momentumText(c)}` }])
}

const LINE_W = 100
const LINE_H = 40

/** A cumulative line's points across the card (0 at the bottom). */
function linePoints(values: readonly number[], max: number): string {
  const step = LINE_W / Math.max(1, values.length - 1)
  return values.map((v, i) => `${(i * step).toFixed(1)},${(LINE_H - 3 - (v / max) * (LINE_H - 6)).toFixed(1)}`).join(' ')
}

/** Its 4 weeks: tasks added (dashed) and closed (solid, the tag's colour), each counted up from the first week's start. */
function PulseLines({ card }: { card: PulseCard }) {
  const added = cumulative(card.added)
  const closed = cumulative(card.closed)
  const max = Math.max(1, added.at(-1) ?? 0, closed.at(-1) ?? 0)
  return (
    <svg className={styles.lines} viewBox={`0 0 ${LINE_W} ${LINE_H}`} preserveAspectRatio="none" aria-hidden="true" data-pulse-lines="">
      <polyline className={styles.added} points={linePoints(added, max)} vectorEffect="non-scaling-stroke" />
      <polyline className={styles.closed} points={linePoints(closed, max)} style={{ stroke: card.tag.color }} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function PulseCardView({ card, onDrill }: { card: PulseCard; onDrill: OnGlanceDrill | undefined }) {
  const name = card.tag.name
  const content = (
    <>
      <span className={styles.cardHead}>
        <i className={styles.swatch} style={{ background: card.tag.color }} aria-hidden="true" />
        <span className={styles.cardName}>{name}</span>
      </span>
      <span className={styles.cardFigures}>
        <span className={styles.ring} style={{ '--pulse-late': `${Math.round(card.lateShare * 100)}%` } as CSSProperties} aria-hidden="true">
          <span className={styles.ringCount}>{card.openIds.length}</span>
        </span>
        <span className={styles.counts}>
          <span className={card.lateIds.length > 0 ? styles.late : undefined}>
            {card.lateIds.length} late{card.lateIds.length > 0 ? ` (${lateShareText(card.lateShare)})` : ''}
          </span>
          <span>{card.staleCount} stale</span>
        </span>
      </span>
      <PulseLines card={card} />
      <span className={styles.momentum} data-momentum={card.momentum}>{momentumText(card)}</span>
    </>
  )
  const label = `#${name}: ${countsText(card)}. ${momentumText(card)}.`
  const common = { className: styles.card, 'data-pulse-card': card.tag.id }
  return onDrill
    ? <button type="button" {...common} aria-label={`${label} Show open tasks`} onClick={() => onDrill(tagRowDrill(card.tag, card.openIds))}>{content}</button>
    : <div {...common} role="group" aria-label={label}>{content}</div>
}

/**
 * Project pulse (D25 L): a card per picked tag — the share of its open
 * tasks that are late as a ring, 4 weeks of tasks added (dashed) and
 * closed (solid), its open / late / stale counts and its momentum
 * (`services/stats/pulse`) — in a grid that flows with the cell. A card
 * opens the tag's open tasks. Small: the worst tag's late share; medium:
 * a line per tag.
 */
export function PulseWidget({ tab, onResult, onDrill }: GlanceWidgetProps<PulseTab>) {
  const base = useStatsBase()
  const cards = usePulse(base, tab.config.tagIds)
  const [faceRef, face] = useWidgetFace()
  const lines = useMemo(() => pulseLines(cards), [cards])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, base.filtered)
  const openTag = (card: PulseCard) => drill?.(tagRowDrill(card.tag, card.openIds))
  // Picks that make no card: the picked tags were deleted since.
  const picked = tab.config.tagIds.length > 0

  if (face === 'small') {
    const worst = worstPulseCard(cards)
    const content = worst
      ? (
        <>
          <span className={styles.pulseSmallShare} data-testid="pulse-worst">{lateShareText(worst.lateShare)} late</span>
          <span className={styles.pulseSmallName}>#{worst.tag.name}</span>
        </>
      )
      : (
        <>
          <span className={styles.pulseSmallName}>Project pulse</span>
          <span className={styles.quiet}>{cards.length > 0 ? 'Nothing late' : picked ? 'Picked tags deleted' : 'No tags picked'}</span>
        </>
      )
    return (
      <GlanceFrame tab={tab}>
        <div ref={faceRef} className={`${styles.face} ${styles.small}`} data-face="small">
          {worst && drill
            ? <button type="button" className={`${styles.drill} ${styles.pulseSmall}`} aria-label={`#${worst.tag.name}: ${lateShareText(worst.lateShare)} late. Show open tasks`} onClick={() => openTag(worst)}>{content}</button>
            : <span className={styles.pulseSmall}>{content}</span>}
        </div>
      </GlanceFrame>
    )
  }

  return (
    <GlanceFrame tab={tab}>
      <div ref={faceRef} className={styles.face} data-face={face}>
        <Panel def={PULSE_DEF} className={`${GLANCE_PANEL_CLASS} ${styles.facePanel}`} count={String(cards.length)} sub="Last 4 weeks">
          {cards.length === 0 ? (
            picked
              ? <Empty title="The picked tags were deleted" hint="Pick the tags to follow in the tab menu’s Tags." />
              : <Empty title="No tags picked" hint="Pick the tags to follow in the tab menu’s Tags." />
          ) : face === 'medium' ? (
            <ul className={styles.pulseList} aria-label="Project pulse">
              {cards.map((c) => {
                const meta = `${c.openIds.length} open · ${lateShareText(c.lateShare)} late · ${c.momentum === 'growing' ? 'Growing' : c.momentum === 'shrinking' ? 'Shrinking' : 'Steady'}`
                const row = (
                  <>
                    <i className={styles.swatch} style={{ background: c.tag.color }} aria-hidden="true" />
                    <span className={styles.pulseRowName}>{c.tag.name}</span>
                    <span className={styles.pulseRowMeta}>{meta}</span>
                  </>
                )
                return (
                  <li key={c.tag.id} data-pulse-card={c.tag.id}>
                    {drill
                      ? <button type="button" className={`${styles.drill} ${styles.pulseRow}`} aria-label={`#${c.tag.name}: ${meta}. Show open tasks`} onClick={() => openTag(c)}>{row}</button>
                      : <span className={styles.pulseRow}>{row}</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className={styles.pulseGrid}>
              {cards.map((c) => <PulseCardView key={c.tag.id} card={c} onDrill={drill} />)}
            </div>
          )}
        </Panel>
      </div>
    </GlanceFrame>
  )
}
