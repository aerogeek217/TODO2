import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, keymap, type Command, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { listMarker, type ListMarker } from '../../../services/note-lines'

const CODE_NODES = new Set(['FencedCode', 'CodeBlock', 'CodeText'])

const MARKERS = {
  bullet: Decoration.mark({ class: 'cm-list-marker', attributes: { 'data-marker': 'bullet' } }),
  open: Decoration.mark({ class: 'cm-list-marker', attributes: { 'data-marker': 'open' } }),
  done: Decoration.mark({ class: 'cm-list-marker', attributes: { 'data-marker': 'done' } }),
}

/** The marker of the line starting at `from`, or null when it has none or sits in a code block. */
function markerAt(state: EditorState, from: number, text: string): ListMarker | null {
  const marker = listMarker(text)
  return marker && !CODE_NODES.has(syntaxTree(state).resolveInner(from, 1).name) ? marker : null
}

function buildMarkers(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      const marker = markerAt(view.state, line.from, line.text)
      if (marker) {
        builder.add(line.from + marker.from, line.from + marker.to, MARKERS[marker.kind])
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

/** Where a selection end at `pos` rests: never inside a marker, and a caret (`caret`) never at its start either. */
function outOfMarker(state: EditorState, pos: number, caret: boolean): number {
  const line = state.doc.lineAt(pos)
  const marker = markerAt(state, line.from, line.text)
  if (!marker) return pos
  const start = line.from + marker.from
  const end = line.from + marker.to
  if (pos < start || pos >= end || (pos === start && !caret)) return pos
  // ← from just after the marker goes on to the text before it.
  const leaving = caret && pos === start && start > 0 && state.selection.main.head === end
  return leaving ? start - 1 : end
}

/**
 * No end of the selection rests inside a marker, and a caret not at its start:
 * the symbol is drawn at the marker's start, so a caret there would show after
 * the symbol while typing went in front of it. Atomic ranges don't cover this:
 * Home and ↑ / ↓ ask for the text under a pixel, and a marker has no width, so
 * they can land anywhere in it — where typing would break its Markdown.
 */
const selectionOutOfMarkers = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged) return tr
  const state = tr.startState
  let moved = false
  const ranges = tr.selection.ranges.map((range) => {
    const anchor = outOfMarker(state, range.anchor, range.empty)
    const head = outOfMarker(state, range.head, range.empty)
    if (anchor === range.anchor && head === range.head) return range
    moved = true
    return EditorSelection.range(anchor, head)
  })
  return moved ? [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }] : tr
})

/**
 * Enter with the caret just after a marker, text after it (where Home puts it):
 * a new empty item above, the text staying an item on its own line with the
 * caret before it. lang-markdown's Enter splits the item there too, but trims
 * the marker it leaves above to a bare `-` (`- [ ]`), which is no longer a
 * list line — a dash, not a bullet. A done box's empty item above is open.
 */
const enterAfterMarker: Command = ({ state, dispatch }) => {
  const range = state.selection.main
  if (state.selection.ranges.length > 1 || !range.empty) return false
  const line = state.doc.lineAt(range.head)
  const marker = markerAt(state, line.from, line.text)
  if (!marker || range.head !== line.from + marker.to || marker.to >= line.length) return false
  const above = line.text.slice(0, marker.to).replace(/\[[xX]\]/, '[ ]')
  dispatch(state.update({
    changes: { from: line.from, insert: `${above}\n` },
    scrollIntoView: true,
    userEvent: 'input',
  }))
  return true
}

/**
 * Shows a list line's marker as a symbol: `- ` as •, `- [ ] ` as ☐, `- [x] `
 * as ☑ (and the `*`, `•` and bare `[ ]` forms alike). Display only: the note's
 * text stays standard Markdown, in the DOM too (the characters are unseen and
 * have no width, the symbol is CSS), so Copy, exports, Convert, Enter and Tab
 * all read what they always did. The caret steps over a marker as one unit.
 */
export const notesListMarkers = [selectionOutOfMarkers, Prec.highest(keymap.of([{ key: 'Enter', run: enterAfterMarker }])), ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildMarkers(view)
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) this.decorations = buildMarkers(update.view)
  }
}, {
  decorations: (plugin) => plugin.decorations,
  provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
})]
