import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  NUMBER_NAME_MAX,
  type NumberCompare,
  type NumberConfig,
} from '../../../models/glance-widgets'
import type { NumberTab } from '../../../models/workspace-layout'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { isInLayerAbove } from '../../../utils/dom-layers'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { getTab } from '../../../utils/workspace-layout-queries'
import { ColorPicker } from '../../shared/ColorPicker'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { CloseIcon } from '../../shared/icons'
import { PopoverRoot } from '../../shared/PopoverRoot'
import { LitWhenControl } from './LitWhenField'
import {
  AUTO_SHOWN,
  GoalFields,
  GroupItemsField,
  ListField,
  OldestByField,
  ShareOfField,
  ShowField,
} from './NumberShapeFields'
import { useLayoutFirstListId } from '../../../hooks/use-number-shapes'
import { switchShape, type ShapeStash } from './number-shape-switch'
import styles from './NumberEditor.module.css'

const COMPARES: ReadonlyArray<{ value: NumberCompare; label: string }> = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'lastWeek', label: 'Same day last week' },
  { value: 'none', label: 'None' },
]

interface NumberEditorProps {
  tab: NumberTab
  /** The Number it sits beside. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}

/** A key that landed on the page itself: nothing is focused. */
function isPageTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target === document.body || target === document.documentElement
}

/**
 * Esc closes the editor when it comes from inside it (or with nothing
 * focused) and nothing inside handled it first — a filter picker, the
 * expression field putting its text back. Bubble phase, after those.
 */
function useEscapeCloses(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  const onCloseRef = useLatestRef(onClose)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = panel.current
      const inside = el != null && e.target instanceof Node && el.contains(e.target)
      if (!inside && !isPageTarget(e.target)) return
      if (el && e.target instanceof Node && isInLayerAbove(el, e.target)) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel, onCloseRef])
}

/** The threshold field: a whole number, written once it reads as one (blank or bad text isn't written). */
/** The Number tab `tabId` names in the open layout, if it is one. */
function useNumberTab(tabId: string | null): NumberTab | undefined {
  return useWorkspaceStore((s) => {
    const tab = tabId != null && s.working ? getTab(s.working, tabId) : undefined
    return tab?.kind === 'number' ? tab : undefined
  })
}

/**
 * The open Number editor (`ui-store.numberEditorTabId`), beside its
 * Number's body (`[data-number-body]`, found on screen). Hosted by the
 * workspace page, outside the widget tree, so no key or press in it reaches
 * the cell's handlers (React events bubble through portals). It closes when
 * the Number leaves the layout or the screen.
 */
export function NumberEditorHost() {
  const tabId = useUIStore((s) => s.numberEditorTabId)
  const tab = useNumberTab(tabId)
  const close = useUIStore((s) => s.closeNumberEditor)
  // The layout: a change (the tab made active, a row expanded) may bring the Number on screen.
  const working = useWorkspaceStore((s) => s.working)
  const anchorRef = useRef<HTMLElement | null>(null)
  const [found, setFound] = useState<string | null>(null)
  useLayoutEffect(() => {
    if (!tab) return
    // Looked for now, and over the next frames while the Number mounts (a new one, a tab just shown).
    let frames = 0
    let raf = 0
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-number-body="${CSS.escape(tab.id)}"]`)
      anchorRef.current = el
      setFound(el ? tab.id : null)
      if (!el && ++frames < 30) raf = requestAnimationFrame(look)
    }
    look()
    return () => cancelAnimationFrame(raf)
  }, [tab, working])
  useEffect(() => {
    if (tabId != null && !tab) close()
  }, [tabId, tab, close])
  useEffect(() => () => useUIStore.getState().closeNumberEditor(), [])
  if (!tab || found !== tab.id) return null
  return <NumberEditor key={tab.id} tab={tab} anchorRef={anchorRef} onClose={close} />
}

/**
 * Edit number (D26 P5, board X): a Number's name, its colour (Auto, then the
 * app's colour picker), the filter it counts — the Graphical / Expression
 * filter Edit list has, with Reads as —, when it lights up, what its change
 * compares with, and whether the top bar's lens applies — and what it shows
 * (D26 P6, Show): a count, a share of a second filter, the oldest task, a
 * goal, several counts (each its own name, colour and filter, in place of
 * its filter and colour) or one of the layout's lists (in place of its
 * filter and lens) — only the active shape's fields. A popover beside
 * the Number, opened by Edit number… (its tab menu) and straight after a
 * Number is added. Every control writes the tab's config at once — layout
 * config, so the layout is unsaved until Save. Esc, × or a press elsewhere
 * close it (an expression that doesn't read holds the first press, as
 * everywhere).
 */
export function NumberEditor({ tab, anchorRef, onClose }: NumberEditorProps) {
  const config = tab.config
  const id = useId()
  const patch = (p: Partial<NumberConfig>) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'number', p)
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    onClose,
    placement: 'bottom-start',
    closeOnScroll: 'user',
    closeOnResize: false,
    closeOnEscape: false,
    observeSize: true,
    caret: true,
  })
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const panelEl = useLatestRef(panel)
  useEscapeCloses(panelEl, onClose)
  // The other shapes' fields, kept while the editor is open (D26 P6): switching back brings them back.
  const [stash, setStash] = useState<ShapeStash>({})
  const firstListId = useLayoutFirstListId()
  const show = config.show
  const onShow = (next: NumberConfig['show']) => {
    const switched = switchShape(config, next, stash, firstListId)
    setStash(switched.stash)
    patch(switched.patch)
  }
  // What each shape uses of the Number's own settings.
  const ownFilter = show !== 'group' && show !== 'list'
  const litUnit = show === 'share' ? '%' : show === 'oldest' ? 'days' : null

  // The focus goes back to the Number when it was inside the editor as it closed.
  useEffect(() => () => {
    const active = document.activeElement
    if (!active || active === document.body || !active.isConnected || panelEl.current?.contains(active)) {
      anchorRef.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus({ preventScroll: true })
    }
  }, [anchorRef, panelEl])

  const auto = config.color == null
  const autoSwatch = (
    <input
      type="radio"
      name={`${id}-auto`}
      className={styles.auto}
      checked={auto}
      onChange={() => patch({ color: undefined })}
      aria-label="Auto (neutral, lit in the accent)"
      title="Auto: neutral, lit in the accent"
      data-hue="auto"
    />
  )

  return createPortal(
    <PopoverRoot
      ref={(el) => {
        panelRef(el)
        setPanel(el)
      }}
      style={style}
      caret={caret}
      className={styles.editor}
      role="dialog"
      aria-labelledby={`${id}-title`}
      data-number-editor={tab.id}
    >
      <div className={styles.header}>
        <span id={`${id}-title`} className={styles.title}>Edit number</span>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}><CloseIcon size={14} /></button>
      </div>
      <div className={styles.body}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input
            type="text"
            className={styles.input}
            value={config.name}
            maxLength={NUMBER_NAME_MAX}
            placeholder="Number"
            autoFocus
            onChange={(e) => patch({ name: e.target.value.slice(0, NUMBER_NAME_MAX) })}
          />
        </label>
        {show !== 'group' && <fieldset className={styles.fieldset}>
          <legend className={styles.label}>Colour</legend>
          <div data-on-auto={auto || undefined} className={styles.colors}>
            <ColorPicker value={config.color ?? AUTO_SHOWN} onChange={(hex) => patch({ color: hex })} before={autoSwatch} />
          </div>
          <span className={styles.hint}>Its label and count while it is lit. Auto: neutral, lit in the accent.</span>
        </fieldset>}
        {ownFilter && <div className={styles.fieldset} role="group" aria-labelledby={`${id}-filter`}>
          <span id={`${id}-filter`} className={styles.label}>Count tasks where</span>
          <div className={styles.filter} data-testid="number-editor-filter">
            <PredicateChips
              predicate={config.filter}
              onChange={(filter) => patch({ filter })}
              addLabel="Count tasks where"
              layout="stack"
              inDialog
              before={hasFilterClause(config.filter) || config.filter.expression ? undefined : <span className={styles.noFilter}>No filter — every open task</span>}
            />
          </div>
        </div>}
        {show === 'share' && <ShareOfField config={config} patch={patch} />}
        {show === 'group' && <GroupItemsField config={config} patch={patch} />}
        <div className={styles.grid}>
          <ShowField value={show} onShow={onShow} />
          {show === 'oldest' && <OldestByField config={config} patch={patch} />}
          {show === 'goal' && <GoalFields config={config} patch={patch} />}
          {show === 'list' && <ListField config={config} patch={patch} />}
          {show !== 'goal' && <div className={styles.field}>
            <span className={styles.label} aria-hidden="true">Light up when</span>
            <LitWhenControl litWhen={config.litWhen} litAt={config.litAt} unit={litUnit} onChange={(next) => patch(next)} />
          </div>}
          {(show === 'count' || show === 'share') && <label className={styles.field}>
            <span className={styles.label}>Compare with</span>
            <select className={styles.select} value={config.compare} onChange={(e) => patch({ compare: e.target.value as NumberCompare })}>
              {COMPARES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>}
          {show !== 'list' && <label className={styles.field}>
            <span className={styles.label}>Top-bar lens</span>
            <select
              className={styles.select}
              value={config.ignoreLens ? 'ignore' : 'follow'}
              onChange={(e) => patch({ ignoreLens: e.target.value === 'ignore' ? true : undefined })}
            >
              <option value="follow">Follow</option>
              <option value="ignore">Ignore</option>
            </select>
          </label>}
        </div>
      </div>
    </PopoverRoot>,
    document.body,
  )
}
