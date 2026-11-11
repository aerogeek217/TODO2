import { useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { PulseTab } from '../../../models/workspace-layout'
import { lensHidesWhere, useLensHidden, usePulse, useStatsBase } from '../../../hooks/use-glance-data'
import { TabLensSwitch } from '../LensSwitch'
import { useWidgetFace } from '../../../hooks/use-widget-face'
import { cumulative, lateShareText, momentumText, worstPulseCard, type PulseCard } from '../../../services/stats/pulse'
import { tagRowDrill } from './glance-drills'
import { glanceDrill, GLANCE_PANEL_CLASS, useReportLines, type GlanceWidgetProps } from './glance-hooks'
import type { SummaryPart } from './glance-summary'
import type { OnGlanceDrill } from './glance-types'
import { GlanceFrame } from './GlanceFrame'
import { Empty, Panel, type PanelDef } from './section-parts'
import { pulseRuleName } from '../../../models/pulse-config'
import { useTagStore } from '../../../stores/tag-store'
import { TagPicker } from '../../shared/TagChipSelector'
import { removePulseTag, togglePulseTag } from './pulse-tags'
import styles from './PulseWidget.module.css'

const PULSE_DEF: PanelDef = { id: 'pulse', title: 'Project pulse', glyph: 'tag', glyphColor: 'var(--color-accent)' }

/** The rules' names as a card's counts read them (G5: `late` and `stale` by default). */
interface PulseNames {
  late: string
  stale: string
}

/** `5 late (24%)`: the late count under its rule's name, with the share while any. */
function lateText(card: PulseCard, names: PulseNames): string {
  const late = card.lateIds.length
  return `${late} ${names.late}${late > 0 ? ` (${lateShareText(card.lateShare)})` : ''}`
}

/** `21 open · 5 late (24%) · 4 stale`. */
function countsText(card: PulseCard, names: PulseNames): string {
  return `${card.openIds.length} open · ${lateText(card, names)} · ${card.staleCount} ${names.stale}`
}

/** The widget's lines for Copy: a card each, `#tag 21 open · 5 late (24%) · 4 stale · Growing: +5 net in 4 weeks`. */
function pulseLines(cards: readonly PulseCard[], names: PulseNames): SummaryPart[][] {
  return cards.map((c) => [{ label: `#${c.tag.name}`, count: `${countsText(c, names)} · ${momentumText(c)}` }])
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

function PulseCardView({ tabId, card, names, onDrill }: { tabId: string; card: PulseCard; names: PulseNames; onDrill: OnGlanceDrill | undefined }) {
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
          <span className={card.lateIds.length > 0 ? styles.late : undefined} data-pulse-count="late">{lateText(card, names)}</span>
          <span data-pulse-count="stale">{`${card.staleCount} ${names.stale}`}</span>
        </span>
      </span>
      <PulseLines card={card} />
      <span className={styles.momentum} data-momentum={card.momentum}>{momentumText(card)}</span>
    </>
  )
  const label = `#${name}: ${countsText(card, names)}. ${momentumText(card)}.`
  const common = { className: styles.card, 'data-pulse-card': card.tag.id }
  return (
    <div className={styles.cardBox}>
      {onDrill
        ? <button type="button" {...common} aria-label={`${label} Show open tasks`} onClick={() => onDrill(tagRowDrill(card.tag, card.openIds))}>{content}</button>
        : <div {...common} role="group" aria-label={label}>{content}</div>}
      {/* Item 9: the ×, shown on the card's hover and focus (always without hover); it removes the tag's card. */}
      <button
        type="button"
        className={styles.remove}
        data-pulse-remove={card.tag.id}
        aria-label={`Remove “${name}” from project pulse`}
        title="Remove from project pulse"
        onClick={() => removePulseTag(tabId, card.tag)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  )
}

/**
 * The tag picker Project pulse's + card and its empty state open (item 9):
 * the app's tag picker, the picked tags ticked — a pick adds its card after
 * the last one, unticking removes it, each its own undo step. It stays open
 * for more picks; Esc or a press outside closes it.
 */
function PulseTagPicker({ tabId, picked, trigger }: {
  tabId: string
  picked: readonly number[]
  /** The trigger, given its ref, whether the picker is open and its toggle. */
  trigger: (ref: RefObject<HTMLButtonElement | null>, open: boolean, toggle: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const tags = useTagStore((s) => s.tags)
  const assigned = useMemo(() => tags.filter((t) => t.id != null && picked.includes(t.id)), [tags, picked])
  return (
    <>
      {trigger(ref, open, () => setOpen((o) => !o))}
      {open && (
        <TagPicker
          anchorRef={ref}
          assignedTags={assigned}
          allTags={tags}
          onToggle={(id) => {
            const tag = tags.find((t) => t.id === id)
            if (tag) togglePulseTag(tabId, tag)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The dashed + card after the last card (item 9): opens the tag picker. */
function AddTagCard({ tabId, picked }: { tabId: string; picked: readonly number[] }) {
  return (
    <PulseTagPicker
      tabId={tabId}
      picked={picked}
      trigger={(ref, open, toggle) => (
        <button ref={ref} type="button" className={styles.addCard} data-pulse-add="" aria-label="Add a tag to project pulse" aria-expanded={open} onClick={toggle}>
          <span className={styles.addPlus} aria-hidden="true">+</span>
          <span>Add tag</span>
        </button>
      )}
    />
  )
}

/** The empty state's Add tag button (no card yet): the same picker. */
function AddTagButton({ tabId, picked }: { tabId: string; picked: readonly number[] }) {
  return (
    <PulseTagPicker
      tabId={tabId}
      picked={picked}
      trigger={(ref, open, toggle) => (
        <button ref={ref} type="button" className={styles.addButton} data-pulse-add="" aria-expanded={open} onClick={toggle}>
          + Add tag
        </button>
      )}
    />
  )
}

/**
 * Project pulse (D25 L): a card per picked tag — the share of its open
 * tasks that are late as a ring, 4 weeks of tasks added (dashed) and
 * closed (solid), its open / late / stale counts and its momentum
 * (`services/stats/pulse`) — in a grid that flows with the cell. A card
 * opens the tag's open tasks. Small: the worst tag's late share; medium:
 * a line per tag. Late and stale follow its rules (G5), and read by their
 * names; its editor (Edit project pulse…, `PulseEditorHost`) opens under
 * its title (`data-pulse-head`). Item 9: the large face ends with a dashed
 * + card that adds a tag (the tag picker), each card has a × that removes
 * its tag, and the empty state's Add tag opens the same picker.
 */
export function PulseWidget({ tab, onResult, onDrill }: GlanceWidgetProps<PulseTab>) {
  const base = useStatsBase()
  const cards = usePulse(base, tab.config)
  const [faceRef, face] = useWidgetFace()
  const lateName = pulseRuleName(tab.config, 'late')
  const staleName = pulseRuleName(tab.config, 'stale')
  const names = useMemo((): PulseNames => ({ late: lateName, stale: staleName }), [lateName, staleName])
  const lines = useMemo(() => pulseLines(cards, names), [cards, names])
  useReportLines(onResult, lines)
  const drill = glanceDrill(onDrill, base.filtered)
  const openTag = (card: PulseCard) => drill?.(tagRowDrill(card.tag, card.openIds))
  // Picks that make no card: the picked tags were deleted since.
  const picked = tab.config.tagIds.length > 0
  // What the lens hides here: open tasks with a picked tag.
  const tagIds = tab.config.tagIds
  const lensHides = lensHidesWhere(useLensHidden(), (t, b) => !t.isCompleted && (b.ctx.assignedTagsMap.get(t.id) ?? []).some((tag) => tag.id != null && tagIds.includes(tag.id)))

  if (face === 'small') {
    const worst = worstPulseCard(cards)
    const content = worst
      ? (
        <>
          <span className={styles.pulseSmallShare} data-testid="pulse-worst">{`${lateShareText(worst.lateShare)} ${names.late}`}</span>
          <span className={styles.pulseSmallName}>#{worst.tag.name}</span>
        </>
      )
      : (
        <>
          <span className={styles.pulseSmallName}>Project pulse</span>
          <span className={styles.quiet}>{cards.length > 0 ? `Nothing ${names.late}` : picked ? 'Picked tags deleted' : 'No tags picked'}</span>
        </>
      )
    return (
      <GlanceFrame tab={tab}>
        <div ref={faceRef} className={`${styles.face} ${styles.small}`} data-face="small" data-pulse-head={tab.id}>
          {worst && drill
            ? <button type="button" className={`${styles.drill} ${styles.pulseSmall}`} aria-label={`#${worst.tag.name}: ${lateShareText(worst.lateShare)} ${names.late}. Show open tasks`} onClick={() => openTag(worst)}>{content}</button>
            : <span className={styles.pulseSmall}>{content}</span>}
        </div>
      </GlanceFrame>
    )
  }

  return (
    <GlanceFrame tab={tab}>
      <div ref={faceRef} className={styles.face} data-face={face}>
        <Panel def={PULSE_DEF} className={`${GLANCE_PANEL_CLASS} ${styles.facePanel}`} count={String(cards.length)} sub="Last 4 weeks" lens={<TabLensSwitch tab={tab} hides={lensHides} />} titleData={{ 'data-pulse-head': tab.id }}>
          {cards.length === 0 ? (
            <Empty
              title={picked ? 'The picked tags were deleted' : 'No tags picked'}
              hint="Add the tags to follow here or in the tab menu’s Tags."
              action={<AddTagButton tabId={tab.id} picked={tagIds} />}
            />
          ) : face === 'medium' ? (
            <ul className={styles.pulseList} aria-label="Project pulse">
              {cards.map((c) => {
                const meta = `${c.openIds.length} open · ${lateShareText(c.lateShare)} ${names.late} · ${c.momentum === 'growing' ? 'Growing' : c.momentum === 'shrinking' ? 'Shrinking' : 'Steady'}`
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
              {cards.map((c) => <PulseCardView key={c.tag.id} tabId={tab.id} card={c} names={names} onDrill={drill} />)}
              <AddTagCard tabId={tab.id} picked={tagIds} />
            </div>
          )}
        </Panel>
      </div>
    </GlanceFrame>
  )
}
