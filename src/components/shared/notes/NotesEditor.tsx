import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import styles from './NotesEditor.module.css'

interface NotesEditorProps {
  value: string
  onChange: (value: string) => void
  onLineChange?: (line: number) => void
  /** Extra key bindings added to the editor (e.g. ⌘T convert-to-task). */
  extraKeymap?: Array<{ key: string; run: (view: EditorView) => boolean }>
  placeholder?: string
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

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        EditorView.lineWrapping,
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

    return () => {
      view.destroy()
      viewRef.current = null
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

  return (
    <div className={styles.host} ref={hostRef} data-placeholder={placeholder ?? undefined} />
  )
}
