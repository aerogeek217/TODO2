import type { Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { singleLineCandidate } from '../../../services/note-lines'
import { showConvertScope } from './notes-convert-highlight'

/** The toolbar's Convert glyph. A fixed string, no note text in it. */
const CONVERT_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h6M2.5 7.5h4"/><rect x="8.5" y="8" width="5.5" height="5.5" rx="1.4"/><path d="M9.9 10.8l1.1 1.1 1.8-2"/></svg>'

const BUTTON_SIZE_PX = 20

/**
 * The convert icon in the editor's left margin, beside the line under the
 * pointer, for any line Alt+T would take (`singleLineCandidate`). One button, moved from line to line, on
 * the first row of a wrapped line; hovering it marks the line
 * (`showConvertScope`). A press keeps the caret and the selection where they
 * are. Not on touch screens, which have no hover (CSS).
 */
export function lineConvert(onConvert: (view: EditorView, line: number) => void): Extension {
  const plugin = ViewPlugin.fromClass(class {
    private readonly button: HTMLButtonElement
    private line: number | null = null

    constructor(private readonly view: EditorView) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'cm-line-convert'
      button.tabIndex = -1
      button.title = 'Convert this line to a task'
      button.setAttribute('aria-label', 'Convert this line to a task')
      button.innerHTML = CONVERT_ICON
      button.addEventListener('mousedown', this.onPress)
      button.addEventListener('click', this.onClick)
      button.addEventListener('pointerenter', this.onButtonEnter)
      button.addEventListener('pointerleave', this.onButtonLeave)
      this.button = button
      view.scrollDOM.append(button)
      view.scrollDOM.addEventListener('mousemove', this.onMove)
      view.scrollDOM.addEventListener('mouseleave', this.hide)
    }

    update(update: ViewUpdate) {
      // The line may have moved or changed: the next move places it again.
      if (update.docChanged || update.geometryChanged) this.hide()
    }

    destroy() {
      this.view.scrollDOM.removeEventListener('mousemove', this.onMove)
      this.view.scrollDOM.removeEventListener('mouseleave', this.hide)
      this.button.remove()
    }

    private readonly onMove = (e: MouseEvent) => {
      const { view } = this
      const scroller = view.scrollDOM.getBoundingClientRect()
      const height = e.clientY - view.documentTop
      if (height < 0 || height > view.contentHeight) {
        this.hide()
        return
      }
      const block = view.lineBlockAtHeight(height)
      const line = view.state.doc.lineAt(block.from)
      if (line.number === this.line) return
      if (!singleLineCandidate(line.text, line.number)) {
        this.hide()
        return
      }
      this.line = line.number
      const firstRowTop = block.top + view.documentTop - scroller.top + view.scrollDOM.scrollTop
      this.button.style.top = `${firstRowTop + (view.defaultLineHeight - BUTTON_SIZE_PX) / 2}px`
      this.button.dataset.show = ''
    }

    private readonly hide = () => {
      this.line = null
      delete this.button.dataset.show
    }

    private readonly onPress = (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    private readonly onClick = (e: MouseEvent) => {
      e.stopPropagation()
      const { line } = this
      if (line === null) return
      showConvertScope(this.view, [])
      this.hide()
      onConvert(this.view, line)
    }

    private readonly onButtonEnter = () => {
      if (this.line !== null) showConvertScope(this.view, [this.line])
    }

    private readonly onButtonLeave = () => {
      showConvertScope(this.view, [])
    }
  })
  return [plugin, EditorView.editorAttributes.of({ class: 'cm-has-line-convert' })]
}
