import type { FilterAtom } from '../../../models/filter-expression'
import { NO_PRIORITY } from '../../../models/filter-predicate'
import { markerTint, type TokenTint } from '../../../services/nlp-token-tints'
import type { ExpressionPiece } from '../../../utils/filter-expression'
import { RemoveButton } from '../RemoveButton'
import tintStyles from '../TintedText.module.css'
import styles from './ExpressionPills.module.css'

/** A pill's tint: the one its term has as typed text (`expressionTints`); text and dates other than due / follow-up are plain pills. */
function pillTint(term: FilterAtom | undefined): TokenTint {
  if (term?.kind === 'priority') return term.value === NO_PRIORITY ? 'chip' : markerTint(term.value)
  if (term?.kind === 'date') return term.field === 'deadline' ? 'due' : term.field === 'followup' || term.field === 'lastFollowup' ? 'followup' : 'chip'
  return 'chip'
}

/**
 * A typed filter at rest (the Review widget's field, the top bar's): its
 * printed pieces (`printPieces`), each term a pill in its typed tint with
 * its own ×, the words and brackets between them muted. A press on an ×
 * calls `onRemove` with its piece (the host takes that term out —
 * `withoutAtom`, or the `done` pill's Show completed); the press never
 * moves the focus. Each pill carries `pillAttr` with its text, each joining
 * piece `data-pill-joiner` (a host that measures what fits reads them).
 */
export function ExpressionPills({ pieces, onRemove, pillAttr }: {
  pieces: readonly ExpressionPiece[]
  onRemove: (piece: ExpressionPiece) => void
  /** The data attribute on each pill, holding its text (`data-review-pill`). */
  pillAttr: `data-${string}`
}) {
  return (
    <>
      {pieces.map((piece, i) => (piece.atom == null && !piece.done ? (
        <span key={i} className={tintStyles.tint} data-tint="operator" data-pill-joiner="" aria-hidden="true">{piece.text}</span>
      ) : (
        <span key={i} className={`${tintStyles.tint} ${styles.pill}`} data-tint={pillTint(piece.term)} {...{ [pillAttr]: piece.text }}>
          <span aria-hidden="true">{piece.text}</span>
          <RemoveButton
            size={14}
            className={styles.pillRemove}
            tabIndex={-1}
            label={`Remove ${piece.text}`}
            tooltip
            // The press doesn't move the focus into the field.
            keepFocus
            onClick={() => onRemove(piece)}
          />
        </span>
      )))}
    </>
  )
}
