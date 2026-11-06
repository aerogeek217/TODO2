import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { commonmarkLanguage, markdownKeymap, pasteURLAsLink } from '@codemirror/lang-markdown'
import { htmlToMarkdown } from '../../../services/notes-export'
import { notesNlp, notesPopupField, type NotesNlpConfig, type NotesPopupState } from './notes-nlp'
import { NotesNlpPopup } from './NotesNlpPopup'
import { convertHighlight } from './notes-convert-highlight'
import { notesIndent } from './notes-indent'
import { lineConvert } from './notes-line-convert'
import { notesListMarkers } from './notes-list-markers'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import styles from './NotesEditor.module.css'
import { shortcutScope } from '../../../utils/dom-contract'

interface NotesEditorProps {
  value: string
  onChange: (value: string) => void
  onLineChange?: (line: number) => void
  /** The main selection (offsets), reported whenever it or the text changes. */
  onSelectionChange?: (selection: { from: number; to: number }) => void
  /** Extra key bindings added to the editor (e.g. ⌘T convert-to-task). */
  extraKeymap?: Array<{ key: string; run: (view: EditorView) => boolean }>
  placeholder?: string
  /**
   * Optional external ref — populated with the live `EditorView` after mount
   * and cleared on unmount. Lets a parent dispatch commands (toolbar buttons,
   * imperative API) without exposing a ref-forwarding ladder.
   */
  viewRef?: { current: EditorView | null }
  /**
   * The `@ # ! /` autocomplete popup and token tints (`notes-nlp`). Read once,
   * when the editor is created.
   */
  nlp?: NotesNlpConfig
  /** Shown to the user when the `nlp` popup's create row fails. */
  onNlpError?: (message: string) => void
  /** The left margin's hover icon converts this line (1-based); absent = no icon and no margin. */
  onLineConvert?: (line: number) => void
  /** That icon's name (default: to a task). */
  lineConvertLabel?: string
}

/**
 * lang-markdown's `markdown()` without its HTML-in-Markdown support, which
 * would bring in lang-html (and with it lang-css and lang-javascript, ~100 KB
 * minified): the CommonMark tree the keymap reads, Enter / Backspace
 * continuing and removing list markup, a URL pasted over a selection becoming
 * a link. Left out on purpose: lang-html's `autoCloseTags` — typing `<div>`
 * in a note no longer adds `</div>` (notes are Markdown; the ~100 KB isn't
 * worth it) — and parts that did nothing here, since the editor installs no
 * highlighting, folding or completion (HTML blocks parsed as HTML, heading
 * folds, `<tag` completion).
 */
const notesMarkdown = [commonmarkLanguage, pasteURLAsLink, Prec.high(keymap.of(markdownKeymap))]

/**
 * CodeMirror 6 wrapper. Deliberately minimal — only imports the
 * state/view/commands/lang-markdown modules so the offline bundle stays
 * small (about 150 KB for the editor).
 *
 * Caret line is reported back via `onLineChange` each time the selection
 * settles; `NotesBody` uses it to decide whether the current line qualifies
 * for ⌘T → task conversion.
 */
export function NotesEditor({
  value,
  onChange,
  onLineChange,
  onSelectionChange,
  extraKeymap = [],
  placeholder,
  viewRef: externalViewRef,
  nlp,
  onNlpError,
  onLineConvert,
  lineConvertLabel,
}: NotesEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useLatestRef(onChange)
  const onLineChangeRef = useLatestRef(onLineChange)
  const onSelectionChangeRef = useLatestRef(onSelectionChange)
  const extraKeymapRef = useLatestRef(extraKeymap)
  const onNlpErrorRef = useLatestRef(onNlpError)
  // The text the parent last saw: the editor's own changes (listener) and the
  // parent's (the value sync effect, before it applies them) write it, so an
  // applied `value` is never reported back as a change.
  const valueRef = useRef(value)
  const keymapCompartment = useRef(new Compartment())
  const lineConvertCompartment = useRef(new Compartment())
  const historyCompartment = useRef(new Compartment())
  const onLineConvertRef = useLatestRef(onLineConvert)
  const hasLineConvert = onLineConvert !== undefined
  const lineConvertExtension = useLatestRef(() => lineConvert((_view, line) => onLineConvertRef.current?.(line), lineConvertLabel))
  const [popup, setPopup] = useState<{ editor: EditorView; state: NotesPopupState } | null>(null)

  useEffect(() => {
    if (!hostRef.current) return

    const buildKeymap = () => keymap.of([
      ...extraKeymapRef.current,
      ...defaultKeymap,
      ...historyKeymap,
    ])

    const pasteHandler = EditorView.domEventHandlers({
      paste(event, view) {
        const clip = event.clipboardData
        if (!clip) return false
        const types = Array.from(clip.types ?? [])
        if (!types.includes('text/html')) return false
        const html = clip.getData('text/html')
        if (!html) return false
        const md = htmlToMarkdown(html)
        if (!md) return false
        const { from, to } = view.state.selection.main
        view.dispatch({
          changes: { from, to, insert: md },
          selection: { anchor: from + md.length },
        })
        event.preventDefault()
        return true
      },
    })

    const state = EditorState.create({
      doc: value,
      extensions: [
        historyCompartment.current.of(history()),
        notesMarkdown,
        EditorView.lineWrapping,
        pasteHandler,
        keymapCompartment.current.of(buildKeymap()),
        nlp
          ? notesNlp({
            ...nlp,
            onCreate: (trigger, name) => nlp.onCreate(trigger, name).catch((err: unknown) => {
              onNlpErrorRef.current?.(err instanceof Error ? err.message : String(err))
            }),
          })
          : [],
        convertHighlight,
        notesListMarkers,
        lineConvertCompartment.current.of(hasLineConvert ? lineConvertExtension.current() : []),
        // Tab / ⇧Tab indent list lines (the popup, above, takes Tab to pick a row while open).
        notesIndent,
        EditorView.updateListener.of((update) => {
          const nextPopup = update.state.field(notesPopupField, false) ?? null
          if (nextPopup !== (update.startState.field(notesPopupField, false) ?? null)) {
            setPopup(nextPopup ? { editor: update.view, state: nextPopup } : null)
          }
          if (update.docChanged) {
            const next = update.state.doc.toString()
            if (next !== valueRef.current) {
              valueRef.current = next
              onChangeRef.current(next)
            }
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head).number - 1
            onLineChangeRef.current?.(line)
            const { from, to } = update.state.selection.main
            onSelectionChangeRef.current?.({ from, to })
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    if (externalViewRef) externalViewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
      if (externalViewRef) externalViewRef.current = null
    }
    // Only build the editor once — later prop changes flow through the refs
    // and the `value` sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // External value changes (a snackbar Undo, a data replace): only re-apply
  // when the editor's own buffer differs. The new text starts a fresh undo
  // history — the old entries describe a text that is gone, and undoing one
  // would write it back over the new value (or splice it in) and save it.
  // The caret stays where it was, inside the new text.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      valueRef.current = value
      const { anchor, head } = view.state.selection.main
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: Math.min(anchor, value.length), head: Math.min(head, value.length) },
        annotations: Transaction.addToHistory.of(false),
        effects: historyCompartment.current.reconfigure([]),
      })
      view.dispatch({ effects: historyCompartment.current.reconfigure(history()) })
    }
  }, [value])

  // The hover icon and its margin come and go with `onLineConvert`.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineConvertCompartment.current.reconfigure(hasLineConvert ? lineConvertExtension.current() : []),
    })
  }, [hasLineConvert, lineConvertExtension])

  // Re-apply the keymap when `extraKeymap` changes.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: keymapCompartment.current.reconfigure(
        keymap.of([
          ...extraKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
      ),
    })
  }, [extraKeymap])

  // Clicking outside the text lands on `.cm-scroller` (its padding, the left
  // margin) or on `.host` itself — neither is contenteditable, so CM6 doesn't
  // auto-focus. Catch those clicks on mousedown (to beat the native focus
  // race), focus the editor and put the caret on the line beside the click;
  // below the last line, at the end of the note.
  const handleHostMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current
    if (!view) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target.closest('.cm-content')) return
    event.preventDefault()
    const belowText = event.clientY - view.documentTop >= view.contentHeight
    const anchor = belowText ? view.state.doc.length : view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    view.dispatch({ selection: { anchor } })
    view.focus()
  }

  return (
    <>
      <div
        className={styles.host}
        ref={hostRef}
        data-placeholder={placeholder ?? undefined}
        {...shortcutScope('none')}
        onMouseDown={handleHostMouseDown}
      />
      {popup && <NotesNlpPopup editor={popup.editor} popup={popup.state} />}
    </>
  )
}
