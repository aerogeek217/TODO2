import { useEffect, useId, useState, type RefObject } from 'react'
import { WidgetEditorHost } from './WidgetEditorHost'
import { createPortal } from 'react-dom'
import {
  NUMBER_NAME_MAX,
  type NumberCompare,
  type NumberConfig,
} from '../../../models/glance-widgets'
import type { NumberTab, LayoutTab } from '../../../models/workspace-layout'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { hasFilterClause } from '../../../utils/filter-clauses'
import { ColorPicker } from '../../shared/ColorPicker'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { ExpressionReportProvider } from '../../shared/filters/expression-report'
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
import { useEditorDraft, widgetEditorElsewhere } from './editor-draft'
import { useEscapeCloses, usePressElsewhereCloses } from '../../../hooks/use-close-events'
import { EditorFooter } from './EditorFooter'
import styles from './NumberEditor.module.css'

const COMPARES: ReadonlyArray<{ value: NumberCompare; label: string }> = [
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'lastWeek', label: 'Same day last week' },
  { value: 'none', label: 'None' },
]

/**
 * One of a Number's two colours (widget feedback 2D): when lit (`color`) or
 * otherwise (`unlitColor`) — the picker with Auto (absent) before its swatches.
 */
function NumberColorField({ name, legend, value, onChange, autoLabel, hint }: {
  /** The Auto radio's group name (unique per field). */
  name: string
  legend: string
  value: string | undefined
  onChange: (color: string | undefined) => void
  autoLabel: string
  hint: string
}) {
  const auto = value == null
  const autoSwatch = (
    <input
      type="radio"
      name={name}
      className={styles.auto}
      checked={auto}
      onChange={() => onChange(undefined)}
      aria-label={autoLabel}
      data-tooltip={autoLabel}
      data-hue="auto"
    />
  )
  return (
    <fieldset className={styles.fieldset} data-number-color={legend}>
      <legend className={styles.label}>{legend}</legend>
      <div data-on-auto={auto || undefined} className={styles.colors}>
        <ColorPicker value={value ?? AUTO_SHOWN} onChange={(hex) => onChange(hex)} before={autoSwatch} />
      </div>
      <span className={styles.hint}>{hint}</span>
    </fieldset>
  )
}

interface NumberEditorProps {
  tab: NumberTab
  /** The Number it sits beside. */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
}

/**
 * The open Number editor (`ui-store.numberEditorTabId`), beside its
 * Number's body (`[data-number-body]`).
 */
export function NumberEditorHost() {
  const tabId = useUIStore((s) => s.numberEditorTabId)
  const close = useUIStore((s) => s.closeNumberEditor)
  return <WidgetEditorHost tabId={tabId} isKind={isNumberTab} anchor="data-number-body" close={close} Editor={NumberEditor} />
}

const isNumberTab = (tab: LayoutTab): tab is NumberTab => tab.kind === 'number'

/**
 * Edit number (D26 P5, board X): a Number's name, its colour (Auto, then the
 * app's colour picker), the filter it counts — the Graphical / Expression
 * filter Edit list has, with Reads as —, when it lights up and what its
 * change compares with — and what it shows (D26 P6, Show): a count, a
 * share of a second filter, the oldest task, a goal, several counts (each
 * its own name, colour and filter, in place of its filter and colour) or
 * one of the layout's lists (in place of its filter) — only the active
 * shape's fields. A popover beside
 * the Number, opened by Edit number… (its tab menu). Its controls edit a copy of the config, which the
 * Number draws live (`useEditorDraft`, Edit list's pattern): Save writes the
 * changes for good as one layout config update — one undo step — and
 * Discard drops them. Esc, × or a press elsewhere close
 * it at once while nothing changed, else ask Save / Discard / Keep editing
 * (an expression that doesn't read holds the first press, as everywhere).
 */
function NumberEditor({ tab, anchorRef, onClose }: NumberEditorProps) {
  const id = useId()
  const edit = useEditorDraft<NumberConfig>({
    tabId: tab.id,
    stored: tab.config,
    write: (p) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'number', p, `Edited number “${(p.name ?? tab.config.name).trim() || 'Number'}”`),
    onClose,
    promptTitle: `Save changes to number “${tab.config.name.trim() || 'Number'}”?`,
  })
  const config = edit.draft
  const patch = edit.patch
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    onClose: edit.requestClose,
    placement: 'bottom-start',
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    observeSize: true,
    caret: true,
  })
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const panelEl = useLatestRef(panel)
  useEscapeCloses(panelEl, edit.requestClose, { leaveLayersAbove: true })
  usePressElsewhereCloses((t) => widgetEditorElsewhere(t, panelEl.current, anchorRef.current), edit.requestClose)
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

  // Against a goal lights by its own rule; every other shape by Light up when — Never: never lit, so only its other colour shows.
  const canLight = show === 'goal' || config.litWhen !== 'never'
  // The shapes that draw a 14-day line: a count and a Share of….
  const hasLine = show === 'count' || show === 'share'

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
        <button type="button" className={styles.close} aria-label="Close" onClick={() => { edit.requestClose() }}><CloseIcon size={14} /></button>
      </div>
      <ExpressionReportProvider value={edit.reportExpression}>
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
          {show !== 'group' && canLight && (
            <NumberColorField
              name={`${id}-lit`}
              legend="Color when lit"
              value={config.color}
              onChange={(color) => patch({ color })}
              autoLabel="Auto: the accent"
              hint={`Its name, count${hasLine ? ' and line' : ''} while it is lit. Auto: the accent.`}
            />
          )}
          {show !== 'group' && (
            <NumberColorField
              name={`${id}-unlit`}
              legend={canLight ? 'Color otherwise' : 'Color'}
              value={config.unlitColor}
              onChange={(unlitColor) => patch({ unlitColor })}
              autoLabel={hasLine ? 'Auto: a gray name, its count in the text color, the line in the accent' : 'Auto: a gray name, its count in the text color'}
              hint={`Its name, count${hasLine ? ' and line' : ''}${canLight ? ' while it is not lit' : ''}. Auto: a gray name and the count in the text color${hasLine ? ', the line in the accent' : ''}.`}
            />
          )}
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
          </div>
        </div>
      </ExpressionReportProvider>
      <EditorFooter draft={edit} />
    </PopoverRoot>,
    document.body,
  )
}
