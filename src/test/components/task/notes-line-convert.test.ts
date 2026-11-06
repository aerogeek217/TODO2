import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { lineConvert } from '../../../components/task/notes/notes-line-convert'

let view: EditorView | null = null
afterEach(() => { view?.destroy(); view = null })

describe('the editor’s convert icon (cr31 security I2)', () => {
  it('is built as SVG elements — the toolbar’s Convert glyph, no markup parsed', () => {
    const parent = document.createElement('div')
    document.body.append(parent)
    view = new EditorView({ state: EditorState.create({ doc: '- One', extensions: [lineConvert(() => {})] }), parent })
    const button = parent.querySelector<HTMLButtonElement>('.cm-line-convert')!
    expect(button.getAttribute('aria-label')).toBe('Convert this line to a task')
    const svg = button.querySelector('svg')!
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(Array.from(svg.children).map((c) => [c.namespaceURI, c.tagName, c.getAttribute('d') ?? c.getAttribute('rx')])).toEqual([
      ['http://www.w3.org/2000/svg', 'path', 'M2.5 4h6M2.5 7.5h4'],
      ['http://www.w3.org/2000/svg', 'rect', '1.4'],
      ['http://www.w3.org/2000/svg', 'path', 'M9.9 10.8l1.1 1.1 1.8-2'],
    ])
    parent.remove()
  })
})
