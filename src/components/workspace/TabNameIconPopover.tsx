import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { iconDescription, iconSummary } from '../../models/icon'
import { tabStripIcon, widgetKindLabel, type LayoutTab } from '../../models/workspace-layout'
import { trendName } from '../../models/glance-widgets'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { tabNameMax, useWorkspaceStore } from '../../stores/workspace-store'
import { getTab } from '../../utils/workspace-layout-queries'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useRecentEmoji } from '../../hooks/use-recent-emoji'
import { IconPickerButton } from '../shared/IconPickerButton'
import { PopoverRoot } from '../shared/PopoverRoot'
import { KEEP_EVENTS_INSIDE } from '../shared/keep-events-inside'
import styles from './TabNameIconPopover.module.css'

/** The name a tab's field starts with: its own name as stored (a list's, a Number's, a chart's, or the tab's), blank for none. */
function storedName(tab: LayoutTab, listName: string | undefined): string {
  switch (tab.kind) {
    case 'lens': return listName ?? ''
    case 'number':
    case 'breakdown':
    case 'pivot': return tab.config.name
    case 'trend': return tab.config.name ?? ''
    default: return tab.name ?? ''
  }
}

/** What the field shows while blank: the name the tab then has. */
function defaultName(tab: LayoutTab): string {
  return tab.kind === 'trend' ? trendName({}) : widgetKindLabel(tab.kind)
}

/** The line under the fields for a kind with a name of its own (the board's: the name is that thing's name). */
function ownNameNote(tab: LayoutTab): string | null {
  switch (tab.kind) {
    case 'lens': return 'This tab shows a list, so the name is the list’s name.'
    case 'number': return 'This tab shows a Number, so the name is the Number’s name.'
    case 'breakdown':
    case 'pivot':
    case 'trend': return 'This tab shows a chart, so the name is the chart’s name.'
    default: return null
  }
}

/**
 * Name and icon… (items 11, 14; the icons board): a tab's name and icon,
 * under the tab (or, alone in its cell, its top line). The name is written
 * when it is left — Enter, Esc, a press outside, the popover closing any
 * way (the popover rule: what was typed sticks) —, one undo step
 * (`renameTab`): a list's name is its list's, a Number's or a chart's its
 * own, any other kind's the tab's (blank: back to the kind's label). The
 * Icon button opens the icon picker; a pick is written at once
 * (`setTabIcon`), one undo step.
 */
export function TabNameIconPopover({ tabId, anchor, onClose }: {
  tabId: string
  /** What it opens under: the tab, or the top line standing for it; a point when neither is there. */
  anchor: RefObject<HTMLElement | null> | { x: number; y: number }
  onClose: () => void
}) {
  const tab = useWorkspaceStore((s) => (s.working ? getTab(s.working, tabId) : undefined))
  const listId = tab?.kind === 'lens' ? tab.config.listDefinitionId : undefined
  const listName = useListDefinitionStore((s) => (listId != null ? s.listDefinitions.find((d) => d.id === listId)?.name : undefined))
  const [initial] = useState(() => (tab ? storedName(tab, listName) : ''))
  const [name, setName] = useState(initial)
  const nameField = useRef<HTMLInputElement | null>(null)
  const recent = useRecentEmoji()
  const ids = useId()
  const isRef = 'current' in anchor
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: isRef ? { kind: 'ref', ref: anchor } : { kind: 'point', x: anchor.x, y: anchor.y },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    consumeEscape: true,
    anchorIsInside: false,
    observeSize: true,
    caret: isRef,
    onClose,
  })

  // The name sticks however it closes (unmount): one write, when it changed.
  const commit = useLatestRef(() => {
    if (!tab || name.trim() === initial.trim()) return
    void useWorkspaceStore.getState().renameTab(tab.id, name)
  })
  useEffect(() => () => commit.current(), [commit])
  // Focus: the name field (its text selected) on open; back to the tab on close, unless the focus went elsewhere.
  const [backEl] = useState(() => ('current' in anchor ? anchor.current : null))
  useEffect(() => {
    const field = nameField.current
    field?.focus()
    field?.select()
    return () => {
      const active = document.activeElement
      const focusLeft = !active || active === document.body || !active.isConnected
      if (focusLeft && backEl?.isConnected) backEl.focus({ preventScroll: true })
    }
  }, [backEl])

  if (!tab) return null
  const shownIcon = tabStripIcon(tab)
  const listGone = tab.kind === 'lens' && listName == null
  const note = ownNameNote(tab)

  return createPortal(
    <PopoverRoot
      ref={panelRef}
      caret={caret}
      role="dialog"
      aria-label="Name and icon"
      className={styles.popover}
      data-tab-name-icon={tab.id}
      style={{ position: style.position, left: style.left, top: style.top }}
      {...KEEP_EVENTS_INSIDE}
    >
      <label className={styles.field}>
        <span className={styles.caption}>Name</span>
        <input
          ref={nameField}
          className={styles.input}
          type="text"
          value={name}
          // The longest name the tab's kind stores (a Number's and a chart's are shorter than a tab's own).
          maxLength={tabNameMax(tab.kind)}
          placeholder={defaultName(tab)}
          disabled={listGone}
          aria-describedby={note ? `${ids}-note` : undefined}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onClose()
            }
          }}
        />
      </label>
      <div className={styles.field}>
        <span className={styles.caption}>Icon</span>
        <IconPickerButton
          shown={shownIcon}
          ariaLabel={`Icon: ${tab.icon ? iconDescription(tab.icon) : `${widgetKindLabel(tab.kind)} icon (the default)`}. Change`}
          summary={tab.icon ? iconSummary(tab.icon) : 'The widget’s own icon'}
          value={tab.icon}
          fallback={shownIcon}
          recent={recent}
          label={`Icon of “${name.trim() || defaultName(tab)}”`}
          onPick={(icon) => { if (icon.kind !== 'status') useWorkspaceStore.getState().setTabIcon(tab.id, icon) }}
        />
      </div>
      {note && <div className={styles.note} id={`${ids}-note`}>{note}</div>}
    </PopoverRoot>,
    document.body,
  )
}
