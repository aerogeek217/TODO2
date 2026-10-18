import { useId, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  PersistedListDefinition,
  RuntimeFilterField,
} from '../../models/list-definition'
import type { TodoGroupBy, TodoSortBy } from '../../models'
import {
  choicesWith,
  GROUP_LABEL,
  LIST_GROUP_CHOICES,
  LIST_PROMPT_CHOICES,
  LIST_SORT_CHOICES,
  NEW_SORT_CHOICES,
  PROMPT_LABEL,
  SORT_LABEL,
  SORT_NOTE,
} from '../../utils/list-options'
import { changedListFields, type ListDefField } from '../../utils/list-def-equal'
import { PredicateChips } from './filters/PredicateChips'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from './icons'
import styles from './ListEditorBody.module.css'

/**
 * How the form is laid out: `popover` — the workspace's compact side
 * popover; `dialog` — Settings › Lists' modal; `sheet` — the phone's half
 * sheet (touch sizes, choices as rows that open a list of choices).
 */
export type ListEditorVariant = 'popover' | 'dialog' | 'sheet'

export interface ListEditorBodyProps {
  draft: PersistedListDefinition
  onChange: (next: PersistedListDefinition) => void
  /** The saved list: rows whose value differs from it are marked changed. */
  saved?: PersistedListDefinition
  variant?: ListEditorVariant
  /** The Name input, for a caller that focuses it on open. */
  nameRef?: RefObject<HTMLInputElement | null>
}

const PROMPT_EDITOR_LABEL: Record<RuntimeFilterField | 'none', string> = { ...PROMPT_LABEL, none: 'Nothing' }

const ROW_LABEL: Record<ListDefField, string> = {
  name: 'Name',
  filters: 'Filters',
  group: 'Group by',
  sort: 'Sort by',
  prompt: 'Prompt for',
}

/** A choice of a select-button / choice list. */
interface Choice<T extends string> {
  value: T
  label: string
  description?: string
  badge?: string
}

type ChoiceField = 'group' | 'sort' | 'prompt'

/**
 * The list editor's form: name, filters (the list widget's filter chips,
 * then Show completed), group by, sort by and the prompt field. Every
 * control calls `onChange` with the edited list at once; the caller decides
 * what that means (the workspace's shared draft, or a dialog's own draft).
 * With `saved`, a row whose value differs from the saved list shows its
 * label in the accent colour with a dot.
 */
export function ListEditorBody({ draft, onChange, saved, variant = 'dialog', nameRef }: ListEditorBodyProps) {
  const idBase = useId()
  const [choiceList, setChoiceList] = useState<ChoiceField | null>(null)
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

  const promptValue = draft.runtimeFilter?.field ?? 'none'
  const groupChoices: Choice<TodoGroupBy>[] = choicesWith<TodoGroupBy>(LIST_GROUP_CHOICES, draft.grouping)
    .map((g) => ({ value: g, label: GROUP_LABEL[g] }))
  const sortChoices: Choice<TodoSortBy>[] = choicesWith<TodoSortBy>(LIST_SORT_CHOICES, draft.sort)
    .map((s) => ({ value: s, label: SORT_LABEL[s], description: SORT_NOTE[s], badge: NEW_SORT_CHOICES.has(s) ? 'NEW' : undefined }))
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

  const filtersRow = (
    <div className={styles.row}>
      {label('filters')}
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-labelledby={`${idBase}-filters-label`}>
          <PredicateChips
            predicate={predicate}
            onChange={(next) => onChange({ ...draft, membership: { kind: 'custom', predicate: next } })}
          />
        </div>
        {variant !== 'sheet' && showCompleted}
      </div>
    </div>
  )

  const pick: { [F in ChoiceField]: (value: string) => void } = {
    group: (v) => onChange({ ...draft, grouping: v as TodoGroupBy }),
    sort: (v) => onChange({ ...draft, sort: v as TodoSortBy }),
    prompt: (v) => setPrompt(v as RuntimeFilterField | 'none'),
  }
  const choiceSpec: { [F in ChoiceField]: { value: string; choices: readonly Choice<string>[] } } = {
    group: { value: draft.grouping, choices: groupChoices },
    sort: { value: draft.sort, choices: sortChoices },
    prompt: { value: promptValue, choices: promptChoices },
  }

  if (variant === 'sheet') {
    if (choiceList) {
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
                    {c.badge && <span className={styles.badge}>{c.badge}</span>}
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
        {nameRow}
        {filtersRow}
        <div className={styles.sheetRows}>
          {(['group', 'sort', 'prompt'] as const).map((field) => {
            const spec = choiceSpec[field]
            const current = spec.choices.find((c) => c.value === spec.value)?.label ?? spec.value
            return (
              <button
                key={field}
                type="button"
                className={styles.sheetRow}
                aria-label={`${ROW_LABEL[field]}: ${current}`}
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
          })}
          {showCompleted}
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.form} ${variant === 'popover' ? styles.compact : ''}`}>
      {nameRow}
      {filtersRow}
      {variant === 'popover' && <div className={styles.rule} role="separator" />}
      {(['group', 'sort', 'prompt'] as const).map((field) => (
        <div key={field} className={styles.row}>
          {label(field)}
          <ChoiceSelect
            labelId={`${idBase}-${field}-label`}
            label={ROW_LABEL[field]}
            value={choiceSpec[field].value}
            choices={choiceSpec[field].choices}
            onPick={pick[field]}
          />
        </div>
      ))}
    </div>
  )
}

const CHOICE_MENU_WIDTH_PX = 242

/** A select-button: the current choice + a chevron; opens a radio menu of the choices under it. */
function ChoiceSelect({ labelId, label, value, choices, onPick }: {
  labelId: string
  label: string
  value: string
  choices: readonly Choice<string>[]
  onPick: (value: string) => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const valueId = useId()
  const [open, setOpen] = useState(false)
  // A click on the button while its menu is open closes it (the menu's
  // outside-click handler already did) instead of reopening it.
  const wasOpen = useRef(false)
  const current = choices.find((c) => c.value === value)
  const entries: MenuEntry[] = choices.map((c) => ({
    kind: 'item',
    label: c.label,
    description: c.description,
    badge: c.badge,
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
        aria-labelledby={`${labelId} ${valueId}`}
        onMouseDown={() => { wasOpen.current = open }}
        onClick={() => {
          if (wasOpen.current) {
            wasOpen.current = false
            return
          }
          setOpen(true)
        }}
      >
        <span id={valueId} className={styles.selectValue}>{current?.label ?? value}</span>
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
