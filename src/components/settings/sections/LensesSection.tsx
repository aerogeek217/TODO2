import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLensHideCounts } from '../../../hooks/use-lens-counts'
import { deleteLens } from '../../../services/lenses'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { predicateLineItems, type FilterChipNames } from '../../../utils/filter-chips'
import { LENS_NAME_MAX, layoutsUsingLens, waitingStatusId, type Lens } from '../../../utils/lens'
import { ChevronDownIcon, PlusIcon } from '../../shared/icons'
import { PredicateChips } from '../../shared/filters/PredicateChips'
import { useChipNames } from '../../shared/filters/filter-menu'
import { lensSummary } from '../../shared/filters/lens-text'
import sectionStyles from './sections.module.css'
import styles from './LensesSection.module.css'

/**
 * Settings › Tasks › Lenses: the lenses — named screen filters a layout
 * picks in the top bar — each a row (name, its filters in a line, the
 * layouts that use it) that opens into its editor: the list filter row's
 * chips, + Filter and pickers (with their "is not" switch), how many open
 * tasks it keeps right now, Rename · Duplicate · Delete (asked first when a
 * layout uses it). + New lens adds one. Every change is saved at once as
 * one undo step with the snackbar. The presets are seeded on the first
 * open. Desktop only.
 */
export function LensesSection() {
  const lenses = useSettingsStore((s) => s.lenses)
  const seeded = useSettingsStore((s) => s.lensPresetsSeeded)
  const statusesLoaded = useStatusStore((s) => s.loaded)
  const statuses = useStatusStore((s) => s.statuses)
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const names = useChipNames()
  const counts = useLensHideCounts(lenses)
  const [openId, setOpenId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  // The presets, once: Not waiting needs the statuses read.
  useEffect(() => {
    if (!seeded && statusesLoaded) void useSettingsStore.getState().seedLensPresets(waitingStatusId(statuses))
  }, [seeded, statusesLoaded, statuses])

  const addLens = async () => {
    const id = await useSettingsStore.getState().addLens('New lens')
    if (id) {
      setOpenId(id)
      setRenaming(id)
    }
  }

  return (
    <div className={sectionStyles.section}>
      <p className={styles.intro}>
        A lens is a saved filter with a name, picked in the top bar for each layout: every widget on the layout shows
        only what it keeps. Edit it like a list’s filters — the same pickers, with their “is not” switch for what to
        leave out. Filters set in the top bar apply on top of it.
      </p>
      {lenses.length === 0 && <p className={styles.empty}>No lenses yet.</p>}
      <div className={styles.list} data-testid="lens-list">
        {lenses.map((lens) => (
          <LensRow
            key={lens.id}
            lens={lens}
            names={names}
            usedBy={layoutsUsingLens(layouts, working, lens.id).map((l) => l.name)}
            keeps={counts.open - (counts.hides.get(lens.id) ?? 0)}
            open={counts.open}
            expanded={openId === lens.id}
            renaming={renaming === lens.id}
            onToggle={() => {
              setOpenId(openId === lens.id ? null : lens.id)
              setRenaming(null)
            }}
            onRename={(on) => setRenaming(on ? lens.id : null)}
            onDuplicated={(id) => setOpenId(id)}
          />
        ))}
      </div>
      <button type="button" className={`${sectionStyles.button} ${sectionStyles.buttonPrimary} ${styles.newLens}`} onClick={() => void addLens()}>
        <PlusIcon size={12} strokeWidth={2} /> New lens
      </button>
    </div>
  )
}

interface LensRowProps {
  lens: Lens
  names: FilterChipNames
  /** The names of the layouts that picked it. */
  usedBy: readonly string[]
  /** Open tasks it keeps now, of `open`. */
  keeps: number
  open: number
  expanded: boolean
  renaming: boolean
  onToggle: () => void
  onRename: (on: boolean) => void
  onDuplicated: (id: string) => void
}

/** One lens: its row, and — open — its editor. */
function LensRow({ lens, names, usedBy, keeps, open, expanded, renaming, onToggle, onRename, onDuplicated }: LensRowProps) {
  const editorId = useId()
  const summary = useMemo(() => lensSummary(lens, names), [lens, names])
  const hasChips = useMemo(() => predicateLineItems(lens.predicate, names).length > 0, [lens.predicate, names])
  const used = usedBy.length > 0 ? usedBy.join(', ') : '—'
  return (
    <div className={`${styles.lens} ${expanded ? styles.lensOpen : ''}`} data-lens-id={lens.id}>
      <div className={styles.head}>
        {renaming ? (
          <RenameField lens={lens} onDone={() => onRename(false)} />
        ) : (
          <button
            type="button"
            className={styles.headButton}
            aria-expanded={expanded}
            aria-controls={expanded ? editorId : undefined}
            onClick={onToggle}
          >
            <span className={styles.name}>{lens.name}</span>
            <span className={styles.summary}>{summary}</span>
            <span className={styles.used} title={usedBy.length > 0 ? `Used by ${used}` : 'No layout uses it'}>{used}</span>
            <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`}><ChevronDownIcon /></span>
          </button>
        )}
      </div>
      {expanded && (
        <div id={editorId} className={styles.editor}>
          <div className={styles.chips} data-testid="lens-filter">
            <PredicateChips
              predicate={lens.predicate}
              onChange={(next) => void useSettingsStore.getState().setLensPredicate(lens.id, next)}
              addLabel="Add a filter to this lens"
              layout="stack"
              inDialog
              before={hasChips ? undefined : <span className={styles.noFilter}>No filter — every task</span>}
            />
          </div>
          <div className={styles.foot}>
            <span data-testid="lens-keeps">
              Keeps <b>{keeps} of {open}</b> open tasks right now
              {usedBy.length > 0 && <> · used by <b>{used}</b></>}
            </span>
            <span className={styles.actions}>
              <button type="button" className={styles.link} onClick={() => onRename(true)}>Rename</button>
              <button
                type="button"
                className={styles.link}
                onClick={async () => {
                  const id = await useSettingsStore.getState().duplicateLens(lens.id)
                  if (id) onDuplicated(id)
                }}
              >
                Duplicate
              </button>
              <button type="button" className={`${styles.link} ${styles.danger}`} onClick={() => void deleteLens(lens.id)}>Delete</button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** The lens's name, edited in place: Enter or leaving saves (a blank name changes nothing), Esc cancels. */
function RenameField({ lens, onDone }: { lens: Lens; onDone: () => void }) {
  const [value, setValue] = useState(lens.name)
  const inputRef = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    if (save) void useSettingsStore.getState().renameLens(lens.id, value)
    onDone()
  }
  return (
    <input
      ref={inputRef}
      className={styles.nameInput}
      aria-label="Lens name"
      value={value}
      maxLength={LENS_NAME_MAX}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          // The field's own Esc: Settings stays open.
          e.preventDefault()
          e.stopPropagation()
          finish(false)
        }
      }}
    />
  )
}
