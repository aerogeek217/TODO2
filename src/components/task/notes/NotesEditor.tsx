import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { htmlToMarkdown } from '../../../services/notes-export'
import { notesNlp, notesPopupField, type NotesNlpConfig, type NotesPopupState } from './notes-nlp'
import { NotesNlpPopup } from './NotesNlpPopup'
import { convertHighlight } from './notes-convert-highlight'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import styles from './NotesEditor.module.css'

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
   * The `@ # /` autocomplete popup and token tints (`notes-nlp`). Read once,
   * when the editor is created.
   */
  nlp?: NotesNlpConfig
  /** Shown to the user when the `nlp` popup's create row fails (e.g. the tag limit). */
  onNlpError?: (message: string) => void
}

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
        history(),
        markdown(),
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

  // External value changes: only re-apply when the editor's own buffer differs.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      valueRef.current = value
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
    }
  }, [value])

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

  // Clicking below the last line of content lands on `.cm-scroller` (its
  // bottom padding) or on `.host` itself — neither is contenteditable, so
  // CM6 doesn't auto-focus. Catch those clicks on mousedown (to beat the
  // native focus race), move the caret to doc end, and focus the editor.
  const handleHostMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current
    if (!view) return
    const target = event.target as HTMLElement | null
    if (!target) return
    if (target.closest('.cm-content')) return
    event.preventDefault()
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    view.focus()
  }

  return (
    <>
      <div
        className={styles.host}
        ref={hostRef}
        data-placeholder={placeholder ?? undefined}
        data-shortcut-scope="none"
        onMouseDown={handleHostMouseDown}
      />
      {popup && <NotesNlpPopup editor={popup.editor} popup={popup.state} />}
    </>
  )
}
