import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

/**
 * Marks the lines a Convert would take while the toolbar's Convert button is
 * hovered or focused (`cm-convert-scope`: a light accent fill and a bar on
 * the left). Set with `setConvertHighlight` (1-based line numbers; an empty
 * list clears it); edits map the marks along.
 */
export const setConvertHighlight = StateEffect.define<readonly number[]>()

const scopeLine = Decoration.line({ class: 'cm-convert-scope' })

const convertHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes)
    for (const effect of tr.effects) {
      if (!effect.is(setConvertHighlight)) continue
      const ranges: Range<Decoration>[] = []
      for (const n of [...new Set(effect.value)].sort((a, b) => a - b)) {
        if (n >= 1 && n <= tr.state.doc.lines) ranges.push(scopeLine.range(tr.state.doc.line(n).from))
      }
      next = Decoration.set(ranges)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export const convertHighlight: Extension = convertHighlightField

/** Shows (or, with an empty list, clears) the convert scope in `view`. */
export function showConvertScope(view: EditorView | null, lines: readonly number[]): void {
  view?.dispatch({ effects: setConvertHighlight.of(lines) })
}
