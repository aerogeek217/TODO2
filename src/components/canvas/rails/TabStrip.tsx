import { useState, type HTMLAttributes, type Ref } from 'react'
import type { Slot, SlotKind, Tab } from '../../../models/canvas-rails'
import { KIND_ICON, KIND_LABEL } from '../../../utils/slot-kind'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { WidgetKindMenu } from '../../shared/WidgetKindMenu'
import styles from './TabStrip.module.css'

export interface TabStripProps {
  slot: Slot
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onAddTab: (kind: SlotKind) => void
  onMore?: (anchor: { x: number; y: number }) => void
  onPopOut?: () => void
  onClose?: () => void
  menuOpen?: boolean
  moreButtonRef?: Ref<HTMLButtonElement>
  dragHandleProps?: HTMLAttributes<HTMLSpanElement> & { ref?: Ref<HTMLSpanElement> }
}

function tabLabel(tab: Tab, listName: string | undefined): string {
  if (tab.type === 'lens') return listName ?? 'List'
  if (tab.type === 'taskboard') return 'Taskboard'
  if (tab.type === 'notes') return 'Notes'
  return 'Calendar'
}

function TabPill({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: Tab
  active: boolean
  onActivate: () => void
  onClose: () => void
}) {
  const listName = useListDefinitionStore((s) =>
    tab.type === 'lens' && tab.listDefinitionId != null
      ? s.listDefinitions.find((d) => d.id === tab.listDefinitionId)?.name
      : undefined
  )
  const label = tabLabel(tab, listName)
  const ariaLabel = `${KIND_LABEL[tab.type]} tab: ${label}`
  return (
    <div
      className={`${styles.pill} ${active ? styles.active : ''}`}
      role="tab"
      aria-selected={active}
      data-tab-id={tab.id}
    >
      <button
        type="button"
        className={styles.pillButton}
        onClick={onActivate}
        aria-label={ariaLabel}
        title={label}
      >
        <span className={styles.kindIcon} aria-hidden="true">{KIND_ICON[tab.type]}</span>
        <span className={styles.label}>{label}</span>
      </button>
      <button
        type="button"
        className={styles.closeBtn}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        aria-label={`Close ${label}`}
        title="Close tab"
      >
        ×
      </button>
    </div>
  )
}

export function TabStrip({
  slot,
  onActivateTab,
  onCloseTab,
  onAddTab,
  onMore,
  onPopOut,
  onClose,
  menuOpen,
  moreButtonRef,
  dragHandleProps,
}: TabStripProps) {
  const [addAnchor, setAddAnchor] = useState<{ x: number; y: number } | null>(null)
  const { ref: dragRef, ...dragRest } = dragHandleProps ?? {}

  return (
    <div className={styles.strip} role="tablist" aria-label="Slot tabs">
      {dragHandleProps && (
        <span
          {...dragRest}
          ref={dragRef}
          className={styles.dragHandle}
          aria-label="Reorder slot"
          role="button"
          tabIndex={-1}
        >
          ⋮⋮
        </span>
      )}
      <div className={styles.tabs}>
        {slot.tabs.map((tab) => (
          <TabPill
            key={tab.id}
            tab={tab}
            active={tab.id === slot.activeTabId}
            onActivate={() => onActivateTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
          />
        ))}
        <button
          type="button"
          className={styles.addBtn}
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
            setAddAnchor({ x: rect.left, y: rect.bottom + 4 })
          }}
          aria-label="Add tab"
          aria-haspopup="menu"
          aria-expanded={addAnchor !== null}
          title="Add tab"
        >
          +
        </button>
      </div>
      <div className={styles.chrome}>
        {onPopOut && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onPopOut}
            aria-label="Pop out to canvas"
            title="Pop out to canvas"
          >
            ↙
          </button>
        )}
        {onMore && (
          <button
            ref={moreButtonRef}
            type="button"
            className={styles.iconButton}
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect()
              onMore({ x: rect.left, y: rect.bottom + 4 })
            }}
            aria-label="Slot options"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? true : false}
            title="Options"
          >
            ⋯
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onClose}
            aria-label="Close slot"
            title="Close slot"
          >
            ×
          </button>
        )}
      </div>
      {addAnchor && (
        <WidgetKindMenu
          anchor={addAnchor}
          onChangeKind={(kind) => { onAddTab(kind); setAddAnchor(null) }}
          onClose={() => setAddAnchor(null)}
          heading="Add tab"
        />
      )}
    </div>
  )
}
