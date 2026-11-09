import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FilterExpr } from '../../../models/filter-expression'
import { expressionNamesOf } from '../../../utils/filter-chips'
import { expressionWords, pieceSpaces, type WordPiece } from '../../../utils/filter-expression'
import { useTooltip } from '../use-tooltip'
import { useChipNames } from './filter-menu'
import styles from './ExpressionWords.module.css'

/** The fade at a clipped line's end: a term starting inside it counts as not shown. */
const FADE_PX = 28

function pieceClass(p: WordPiece): string {
  if (p.kind === 'name') return styles.name ?? ''
  return (p.kind === 'word' ? styles.word : styles.joiner) ?? ''
}

/**
 * A filter written as an expression on the list's filter line, read back in
 * words (D26 board BF, `filter-expression/words`): names as chips styled as
 * the Graphical chips, word terms, joining words muted. Too long for its
 * space, it fades at its end and says `+N more` — the top-level terms that
 * start past what shows. The tooltip holds the exact expression; a click
 * opens where it is edited (Edit list) when `onOpen` is given.
 */
export function ExpressionWords({ expression, text, onOpen }: {
  expression: FilterExpr
  /** The exact expression (`printExpression`): the tooltip. */
  text: string
  onOpen?: () => void
}) {
  const names = useChipNames()
  const words = useMemo(() => expressionWords(expression, expressionNamesOf(names)), [expression, names])
  const spaces = useMemo(() => pieceSpaces(words.pieces), [words])
  const clipRef = useRef<HTMLSpanElement>(null)
  const [fit, setFit] = useState({ clipped: false, hidden: 0 })

  useLayoutEffect(() => {
    const clip = clipRef.current
    if (!clip) return
    const measure = () => {
      const clipped = clip.scrollWidth > clip.clientWidth + 1
      let hidden = 0
      if (clipped) {
        const edge = clip.getBoundingClientRect().right - FADE_PX
        // Each top-level term's first piece (its ` · ` left out): past the fade, the term isn't shown.
        const seen = new Set<string>()
        for (const el of clip.querySelectorAll<HTMLElement>('[data-term]')) {
          const term = el.dataset.term ?? ''
          if (seen.has(term)) continue
          seen.add(term)
          if (el.getBoundingClientRect().left >= edge) hidden++
        }
      }
      setFit((f) => (f.clipped === clipped && f.hidden === hidden ? f : { clipped, hidden }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(clip)
    return () => ro.disconnect()
  }, [words])

  const tip = useTooltip(onOpen ? `${text}\nClick to edit` : text, { labelLines: 1 })
  const content = (
    <>
      <span ref={clipRef} className={`${styles.clip} ${fit.clipped ? styles.clipFaded : ''}`}>
        {words.pieces.map((p, i) => {
          const separator = p.kind === 'joiner' && p.text === '·'
          return (
            <Fragment key={i}>
              {/* A space of its own (a flex row drops a bare one), so the text reads with its spaces too. */}
              {spaces[i] && <span className={styles.space}>{spaces[i]}</span>}
              <span className={pieceClass(p)} data-piece={p.kind} data-term={separator ? undefined : p.term}>{p.text}</span>
            </Fragment>
          )
        })}
      </span>
      {fit.hidden > 0 && <span className={styles.more} aria-hidden="true" data-testid="list-filter-expression-more">+{fit.hidden} more</span>}
      {tip.tooltip}
    </>
  )
  return onOpen ? (
    <button type="button" className={styles.line} data-testid="list-filter-expression" onClick={onOpen} {...tip.triggerProps}>
      {content}
    </button>
  ) : (
    <span className={styles.line} data-testid="list-filter-expression" tabIndex={0} {...tip.triggerProps}>
      {content}
    </span>
  )
}
