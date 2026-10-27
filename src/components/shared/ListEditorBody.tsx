import { useId, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  PersistedListDefinition,
  RuntimeFilterField,
} from '../../models/list-definition'
import type { TodoGroupBy, TodoSortBy, TodoSortDirection } from '../../models'
import { effectiveSortDirection, sortHasDirection } from '../../models'
import {
  choicesWith,
  GROUP_LABEL,
  GROUP_NOTE,
  LIST_GROUP_CHOICES,
  LIST_PROMPT_CHOICES,
  LIST_SORT_CHOICES,
  PROMPT_LABEL,
  SORT_LABEL,
  SORT_NOTE,
  sortOrderWords,
  withListSort,
  withSortDirection,
} from '../../utils/list-options'
import { changedListFields, type ListDefField } from '../../utils/list-def-equal'
import type { CopySourceGroup } from '../../utils/list-copy'
import type { CopySource } from '../../hooks/use-copy-sources'
import { CopyFromMenu } from './CopyFromMenu'
import { PredicateChips } from './filters/PredicateChips'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SortDirectionIcon } from './icons'
import { useTooltip } from './use-tooltip'
import styles from './ListEditorBody.module.css'

/**
 * How the form is laid out: `popover` — the workspace's compact side
 * popover; `sheet` — the phone's half sheet (touch sizes, choices as rows
 * that open a list of choices).
 */
export type ListEditorVariant = 'popover' | 'sheet'

export interface ListEditorBodyProps {
  draft: PersistedListDefinition
  onChange: (next: PersistedListDefinition) => void
  /** The saved list: rows whose value differs from it are marked changed. */
  saved?: PersistedListDefinition
  variant?: ListEditorVariant
  /** The Name input, for a caller that focuses it on open. */
  nameRef?: RefObject<HTMLInputElement | null>
  /**
   * A `Copy from…` control at the top: its chooser offers `groups`
   * (`useCopySources`); a pick calls `onPick` — the caller copies the
   * list's parts into the draft. Omit for none.
   */
  copyFrom?: {
    groups: readonly CopySourceGroup<CopySource>[]
    onPick: (source: CopySource) => void
  }
}

const PROMPT_EDITOR_LABEL: Record<RuntimeFilterField | 'none', string> = { ...PROMPT_LABEL, none: 'Nothing' }

const ROW_LABEL: Record<ListDefField, string> = {
  name: 'Name',
  filters: 'Filters',
  group: 'Group by',
  sort: 'Sort by',
  prompt: 'Prompt for',
  filterLine: 'Filter line',
}

/** The Show filter line control's words: what the line is, and that an unsaved list still shows it. */
const FILTER_LINE_HINT = 'The line above the tasks: filters and group · sort. Hidden, it still shows while the list has unsaved changes.'

/** A choice of a select-button / choice list. */
interface Choice<T extends string> {
  value: T
  label: string
  description?: string
}

type ChoiceField = 'group' | 'sort' | 'prompt'

/** Copy from's control and the chooser's name. */
const COPY_FROM_LABEL = 'Copy from…'

/**
 * The list editor's form: name, filters (the list widget's filter chips,
 * then Show completed), group by, sort by, the prompt field and Show filter
 * line. Every
 * control calls `onChange` with the edited list at once; the caller decides
 * what that means (the workspace's shared draft, or a dialog's own draft).
 * With `saved`, a row whose value differs from the saved list shows its
 * label in the accent colour with a dot.
 */
export function ListEditorBody({ draft, onChange, saved, variant = 'popover', nameRef, copyFrom }: ListEditorBodyProps) {
  const idBase = useId()
  const [choiceList, setChoiceList] = useState<ChoiceField | 'copyFrom' | null>(null)
  // The list last copied from, named under the control.
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null)
  const pickCopy = (source: CopySource) => {
    copyFrom?.onPick(source)
    setCopiedFrom(source.name)
  }
  const copiedNote = copiedFrom != null && (
    <span className={styles.copiedNote} role="status">Copied from “{copiedFrom}” · unsaved</span>
  )
  const predicate = draft.membership.predicate
  const changed = useMemo(() => (saved ? changedListFields(draft, saved) : new Set<ListDefField>()), [draft, saved])

  const setPrompt = (value: RuntimeFilterField | 'none') => {
    if (value === 'none') {
      if (!draft.runtimeFilter) return
      const next = { ...draft }
      delete next.runtimeFilter
      onChange(next)
      return
    }
    if (draft.runtimeFilter?.field === value) return
    onChange({ ...draft, runtimeFilter: { field: value } })
  }
  const setShowCompleted = (showCompleted: boolean) =>
    onChange({ ...draft, membership: { kind: 'custom', predicate: { ...predicate, showCompleted } } })
  // Only `false` is stored: shown is the default.
  const setShowFilterLine = (show: boolean) => {
    const next = { ...draft }
    if (show) delete next.showFilterLine
    else next.showFilterLine = false
    onChange(next)
  }

  const promptValue = draft.runtimeFilter?.field ?? 'none'
  const groupChoices: Choice<TodoGroupBy>[] = choicesWith<TodoGroupBy>(LIST_GROUP_CHOICES, draft.grouping)
    .map((g) => ({ value: g, label: GROUP_LABEL[g], description: GROUP_NOTE[g] }))
  const sortChoices: Choice<TodoSortBy>[] = choicesWith<TodoSortBy>(LIST_SORT_CHOICES, draft.sort)
    .map((s) => ({ value: s, label: SORT_LABEL[s], description: SORT_NOTE[s] }))
  const promptChoices: Choice<RuntimeFilterField | 'none'>[] = choicesWith<RuntimeFilterField | 'none'>(LIST_PROMPT_CHOICES, promptValue)
    .map((p) => ({ value: p, label: PROMPT_EDITOR_LABEL[p] }))

  const label = (field: ListDefField, htmlFor?: string) => {
    const content = (
      <>
        {changed.has(field) && <span className={styles.changedDot} aria-hidden="true" />}
        {ROW_LABEL[field]}
      </>
    )
    const className = `${styles.label} ${changed.has(field) ? styles.labelChanged : ''}`
    return htmlFor
      ? <label className={className} htmlFor={htmlFor} id={`${idBase}-${field}-label`} data-changed={changed.has(field) || undefined}>{content}</label>
      : <span className={className} id={`${idBase}-${field}-label`} data-changed={changed.has(field) || undefined}>{content}</span>
  }

  const nameEmpty = draft.name.trim() === ''
  const nameRow = (
    <div className={styles.row}>
      {label('name', `${idBase}-name`)}
      <input
        ref={nameRef}
        id={`${idBase}-name`}
        type="text"
        className={`${styles.input} ${nameEmpty ? styles.inputError : ''}`}
        value={draft.name}
        aria-invalid={nameEmpty || undefined}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="List name"
      />
    </div>
  )

  const showCompleted = (
    <label className={variant === 'sheet' ? styles.switchRow : styles.check}>
      {variant === 'sheet' && <span className={styles.switchLabel}>Show completed tasks</span>}
      <input
        type="checkbox"
        role={variant === 'sheet' ? 'switch' : undefined}
        className={variant === 'sheet' ? styles.switch : undefined}
        checked={predicate.showCompleted}
        onChange={(e) => setShowCompleted(e.target.checked)}
      />
      {variant !== 'sheet' && 'Show completed tasks'}
    </label>
  )

  const filterLineShown = draft.showFilterLine !== false
  const filterLineSwitch = variant === 'sheet'
    ? (
      <label className={styles.switchRow} title={FILTER_LINE_HINT}>
        <span className={`${styles.switchLabel} ${changed.has('filterLine') ? styles.labelChanged : ''}`} data-changed={changed.has('filterLine') || undefined}>
          {changed.has('filterLine') && <span className={styles.changedDot} aria-hidden="true" />}
          Show filter line
        </span>
        <input
          type="checkbox"
          role="switch"
          className={styles.switch}
          checked={filterLineShown}
          onChange={(e) => setShowFilterLine(e.target.checked)}
        />
      </label>
    )
    : (
      <div className={styles.row}>
        {label('filterLine')}
        <label className={styles.check} title={FILTER_LINE_HINT}>
          <input
            type="checkbox"
            aria-label="Show filter line"
            checked={filterLineShown}
            onChange={(e) => setShowFilterLine(e.target.checked)}
          />
          Show
        </label>
      </div>
    )

  const filtersRow = (
    <div className={styles.row}>
      {label('filters')}
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-labelledby={`${idBase}-filters-label`}>
          <PredicateChips
            predicate={predicate}
            onChange={(next) => onChange({ ...draft, membership: { kind: 'custom', predicate: next } })}
            // Esc closes an open field picker only, not Edit list around it.
            inDialog
            layout="stack"
          />
        </div>
        {variant !== 'sheet' && showCompleted}
      </div>
    </div>
  )

  const pick: { [F in ChoiceField]: (value: string) => void } = {
    group: (v) => onChange({ ...draft, grouping: v as TodoGroupBy }),
    sort: (v) => onChange(withListSort(draft, v as TodoSortBy)),
    prompt: (v) => setPrompt(v as RuntimeFilterField | 'none'),
  }
  // An unset Group by shows no value (a placeholder on desktop, nothing on the sheet's row).
  const choiceSpec: { [F in ChoiceField]: { value: string; choices: readonly Choice<string>[]; unset?: string } } = {
    group: { value: draft.grouping, choices: groupChoices, unset: 'none' },
    sort: { value: draft.sort, choices: sortChoices },
    prompt: { value: promptValue, choices: promptChoices },
  }

  // Sort by's ↑ / ↓ beside it: only for a sort with a direction (never Manual).
  const directionToggle = sortHasDirection(draft.sort)
    ? (
      <SortDirectionToggle
        sort={draft.sort}
        direction={effectiveSortDirection(draft.sort, draft.sortDirection)}
        onChange={(direction) => onChange(withSortDirection(draft, direction))}
      />
    )
    : null

  if (variant === 'sheet') {
    if (choiceList === 'copyFrom' && copyFrom) {
      return (
        <div className={`${styles.form} ${styles.sheet}`}>
          <div className={styles.choiceHeader}>
            <button type="button" className={styles.back} aria-label="Back" onClick={() => setChoiceList(null)}>
              <ChevronLeftIcon size={16} />
            </button>
            <span className={styles.choiceTitle}>Copy from</span>
          </div>
          <CopyFromSheetList groups={copyFrom.groups} onPick={(source) => { pickCopy(source); setChoiceList(null) }} />
        </div>
      )
    }
    if (choiceList && choiceList !== 'copyFrom') {
      const spec = choiceSpec[choiceList]
      return (
        <div className={`${styles.form} ${styles.sheet}`}>
          <div className={styles.choiceHeader}>
            <button type="button" className={styles.back} aria-label="Back" onClick={() => setChoiceList(null)}>
              <ChevronLeftIcon size={16} />
            </button>
            <span className={styles.choiceTitle}>{ROW_LABEL[choiceList]}</span>
          </div>
          <div role="radiogroup" aria-label={ROW_LABEL[choiceList]} className={styles.choiceList}>
            {spec.choices.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={c.value === spec.value}
                className={styles.choiceRow}
                onClick={() => { pick[choiceList](c.value); setChoiceList(null) }}
              >
                <span className={styles.choiceRadio} aria-hidden="true" />
                <span className={styles.choiceText}>
                  <span className={styles.choiceLabel}>
                    {c.label}
                  </span>
                  {c.description && <span className={styles.choiceNote}>{c.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className={`${styles.form} ${styles.sheet}`}>
        {copyFrom && (
          <div className={styles.copyRow}>
            <button type="button" className={styles.sheetRow} onClick={() => setChoiceList('copyFrom')}>
              <span className={styles.sheetRowLabel}>{COPY_FROM_LABEL}</span>
              <ChevronRightIcon size={14} />
            </button>
            {copiedNote}
          </div>
        )}
        {nameRow}
        {filtersRow}
        <div className={styles.sheetRows}>
          {(['group', 'sort', 'prompt'] as const).map((field) => {
            const spec = choiceSpec[field]
            const current = spec.value === spec.unset
              ? ''
              : spec.choices.find((c) => c.value === spec.value)?.label ?? spec.value
            const row = (
              <button
                key={field}
                type="button"
                className={styles.sheetRow}
                aria-label={current ? `${ROW_LABEL[field]}: ${current}` : ROW_LABEL[field]}
                data-changed={changed.has(field) || undefined}
                onClick={() => setChoiceList(field)}
              >
                <span className={`${styles.sheetRowLabel} ${changed.has(field) ? styles.labelChanged : ''}`}>
                  {changed.has(field) && <span className={styles.changedDot} aria-hidden="true" />}
                  {ROW_LABEL[field]}
                </span>
                <span className={styles.sheetRowValue}>{current}</span>
                <ChevronRightIcon size={14} />
              </button>
            )
            if (field !== 'sort' || !directionToggle) return row
            return (
              <div key={field} className={styles.sheetRowWithToggle}>
                {row}
                {directionToggle}
              </div>
            )
          })}
          {showCompleted}
          {filterLineSwitch}
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.form} ${styles.compact}`}>
      {copyFrom && (
        <div className={styles.copyRow}>
          <CopyFromButton groups={copyFrom.groups} onPick={pickCopy} />
          {copiedNote}
        </div>
      )}
      {nameRow}
      {filtersRow}
      <div className={styles.rule} role="separator" />
      {(['group', 'sort', 'prompt'] as const).map((field) => (
        <div key={field} className={styles.row}>
          {label(field)}
          <ChoiceSelect
            labelId={`${idBase}-${field}-label`}
            label={ROW_LABEL[field]}
            value={choiceSpec[field].value}
            choices={choiceSpec[field].choices}
            placeholder={choiceSpec[field].value === choiceSpec[field].unset ? `${ROW_LABEL[field]}…` : undefined}
            onPick={pick[field]}
          />
          {field === 'sort' && directionToggle}
        </div>
      ))}
      {filterLineSwitch}
    </div>
  )
}

const CHOICE_MENU_WIDTH_PX = 242

/**
 * `Copy from…`: opens Copy from's chooser under it; a pick hands the list
 * over (the focus comes back to the button).
 */
function CopyFromButton({ groups, onPick }: {
  groups: readonly CopySourceGroup<CopySource>[]
  onPick: (source: CopySource) => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${styles.copyFrom} ${open ? styles.selectOpen : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Take the filters, group, sort, prompt and filter line of another list"
        // The menu leaves a press on its own button to the button: it toggles.
        onClick={() => setOpen((o) => !o)}
      >
        {COPY_FROM_LABEL}
        <ChevronDownIcon />
      </button>
      {open && (
        <CopyFromMenu
          anchorRef={ref}
          label="Copy from"
          groups={groups}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** The phone sheet's Copy from list: a heading per layout (then the Eisenhower), a row per list. */
function CopyFromSheetList({ groups, onPick }: {
  groups: readonly CopySourceGroup<CopySource>[]
  onPick: (source: CopySource) => void
}) {
  if (groups.length === 0) return <p className={styles.choiceNote}>No lists to copy from.</p>
  return (
    <div className={styles.choiceList}>
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.heading} className={styles.choiceList}>
          <span className={styles.copyHeading}>{group.heading}</span>
          {group.lists.map((source) => (
            <button key={source.id} type="button" className={styles.choiceRow} onClick={() => onPick(source)}>
              <span className={styles.choiceText}>
                <span className={styles.choiceLabel}>{source.name}</span>
                <span className={styles.choiceNote}>{source.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Sort by's direction: a toggle button showing ↑ (the sort's natural order)
 * or ↓ (reversed, `aria-pressed`). Its tooltip says what comes first.
 */
function SortDirectionToggle({ sort, direction, onChange }: {
  sort: TodoSortBy
  direction: TodoSortDirection
  onChange: (direction: TodoSortDirection) => void
}) {
  const desc = direction === 'desc'
  const words = sortOrderWords(sort, direction)
  const { triggerProps, tooltip } = useTooltip(words && `${words}\nClick to reverse`)
  return (
    <>
      <button
        type="button"
        className={styles.direction}
        aria-label="Sort descending"
        aria-pressed={desc}
        data-direction={direction}
        onClick={() => onChange(desc ? 'asc' : 'desc')}
        {...triggerProps}
      >
        <SortDirectionIcon direction={direction} />
      </button>
      {tooltip}
    </>
  )
}

/**
 * A select-button: the current choice + a chevron; opens a radio menu of the
 * choices under it. With `placeholder` it shows that, muted, instead of the
 * current choice (an unset field) and is named by its label alone.
 */
function ChoiceSelect({ labelId, label, value, choices, placeholder, onPick }: {
  labelId: string
  label: string
  value: string
  choices: readonly Choice<string>[]
  placeholder?: string
  onPick: (value: string) => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const valueId = useId()
  const [open, setOpen] = useState(false)
  const current = choices.find((c) => c.value === value)
  const entries: MenuEntry[] = choices.map((c) => ({
    kind: 'item',
    label: c.label,
    description: c.description,
    radio: true,
    indicator: 'radio',
    checked: c.value === value,
    onSelect: () => { if (c.value !== value) onPick(c.value) },
  }))
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`${styles.select} ${open ? styles.selectOpen : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-labelledby={placeholder ? labelId : `${labelId} ${valueId}`}
        // The menu leaves a press on its own button to the button: it toggles.
        onClick={() => setOpen((o) => !o)}
      >
        {placeholder
          ? <span className={`${styles.selectValue} ${styles.selectPlaceholder}`} data-placeholder="" aria-hidden="true">{placeholder}</span>
          : <span id={valueId} className={styles.selectValue}>{current?.label ?? value}</span>}
        <ChevronDownIcon />
      </button>
      {open && (
        <MenuPopover
          anchorRef={ref}
          placement="bottom-start"
          width={CHOICE_MENU_WIDTH_PX}
          label={label}
          entries={entries}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
