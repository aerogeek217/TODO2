import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { htmlToMarkdown } from '../../../services/notes-export'
import styles from './NotesEditor.module.css'

interface NotesEditorProps {
  value: string
  onChange: (value: string) => void
  onLineChange?: (line: number) => void
  /** Extra key bindings added to the editor (e.g. ⌘T convert-to-task). */
  extraKeymap?: Array<{ key: string; run: (view: EditorView) => boolean }>
  placeholder?: string
  /**
   * Optional external ref — populated with the live `EditorView` after mount
   * and cleared on unmount. Lets a parent dispatch commands (toolbar buttons,
   * imperative API) without exposing a ref-forwarding ladder.
   */
  viewRef?: { current: EditorView | null }
}

/**
 * CodeMirror 6 wrapper. Deliberately minimal — only imports the
 * state/view/commands/lang-markdown modules so the offline bundle stays
 * within budget (plan target: ~150 KB added over the pre-Phase-3 bundle).
 *
 * Caret line is reported back via `onLineChange` each time the selection
 * settles; `NotesBody` uses it to decide whether the current line qualifies
 * for ⌘T → task conversion.
 */
export function NotesEditor({
  value,
  onChange,
  onLineChange,
  extraKeymap = [],
  placeholder,
  viewRef: externalViewRef,
}: NotesEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onLineChangeRef = useRef(onLineChange)
  const extraKeymapRef = useRef(extraKeymap)
  const valueRef = useRef(value)
  const keymapCompartment = useRef(new Compartment())

  onChangeRef.current = onChange
  onLineChangeRef.current = onLineChange
  extraKeymapRef.current = extraKeymap
  valueRef.current = value

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
        EditorView.updateListener.of((update) => {
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
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      })
      valueRef.current = value
    }
  }, [value])

  // Re-apply keymap when extraKeymap contents change (shallow compare on length + keys).
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: keymapCompartment.current.reconfigure(
        keymap.of([
          ...extraKeymapRef.current,
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
    <div
      className={styles.host}
      ref={hostRef}
      data-placeholder={placeholder ?? undefined}
      data-shortcut-scope="none"
      onMouseDown={handleHostMouseDown}
    />
  )
}
