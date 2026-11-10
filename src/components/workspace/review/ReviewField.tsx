import { useRef, useState, type ReactNode, type RefObject } from 'react'
import { REVIEW_BY_KINDS, REVIEW_BY_LABEL, type ReviewBy } from '../../../models/review'
import { ChevronDownIcon } from '../../shared/icons'
import { MenuPopover, type MenuEntry } from '../../shared/MenuPopover'
import { PromptField, type PromptOption } from '../../shared/PromptField'
import { REVIEW_KIND_WORDS } from './review-choices'
import styles from './ReviewWidget.module.css'

/**
 * The Review widget's prompt row (board BM): a list's Prompt for
 * (`PromptField`) — chips with ×, type to match, ⏎ picks the first — over
 * the widget's kind, whose label is a small menu (`Person ▾` → Review by:
 * Person · Tag · Status · List). The kind is the widget's saved setting
 * (`onBy`); the picks are temporary (`onPicks`). Its options are the
 * caller's (`review-choices.useReviewChoices`).
 */
export function ReviewField({ by, options, picks, onPicks, onBy, inputRef, trailing }: {
  by: ReviewBy
  options: readonly PromptOption[]
  picks: readonly number[]
  onPicks: (ids: number[]) => void
  onBy: (by: ReviewBy) => void
  inputRef: RefObject<HTMLInputElement | null>
  /** At the row's end: the progress and the lens switch, where the widget has no top line of its own. */
  trailing?: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const label = REVIEW_BY_LABEL[by]
  const entries: MenuEntry[] = [
    { kind: 'label', text: 'Review by' },
    ...REVIEW_BY_KINDS.map((kind): MenuEntry => ({
      kind: 'item',
      label: REVIEW_BY_LABEL[kind],
      radio: true,
      checked: kind === by,
      onSelect: () => onBy(kind),
    })),
  ]
  const words = REVIEW_KIND_WORDS[by]
  return (
    <>
      <PromptField
        // A new kind is a new field — its typed text and highlight go with the old one —, the row and its label
        // button staying (the menu hands the focus back to it).
        resetKey={by}
        label={label}
        labelControl={(
          <button
            ref={buttonRef}
            type="button"
            className={styles.kindButton}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Review by: ${label}`}
            data-testid="review-by"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {label} <ChevronDownIcon size={10} />
          </button>
        )}
        options={options}
        value={picks}
        onChange={onPicks}
        inputRef={inputRef}
        inputLabel={words.input}
        placeholder={`Pick ${words.a}…`}
        emptyText={words.none}
        chipMarks
        trailing={trailing}
      />
      {menuOpen && (
        <MenuPopover anchorRef={buttonRef} entries={entries} label="Review by" width={150} onClose={() => setMenuOpen(false)} />
      )}
    </>
  )
}
