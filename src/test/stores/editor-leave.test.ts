import { describe, it, expect, vi } from 'vitest'
import { useChartWidgetsStore } from '../../stores/chart-widgets-store'
import { afterLeavingEditors, closeOpenEditors, editorsHoldChanges, leaveOpenEditors, registerOpenEditor } from '../../stores/editor-leave'
import { useUIStore } from '../../stores/ui-store'

const editor = (changed: boolean, answer: boolean) => ({ changed: () => changed, ask: vi.fn(() => Promise.resolve(answer)) })

describe('editor-leave: nothing leaves an editor with changes without its question', () => {
  it('no editor, or none with changes: runs at once, asking nothing', () => {
    const run = vi.fn()
    afterLeavingEditors(run)
    expect(run).toHaveBeenCalledTimes(1)
    const clean = editor(false, true)
    const off = registerOpenEditor(clean)
    afterLeavingEditors(run)
    expect(run).toHaveBeenCalledTimes(2)
    expect(clean.ask).not.toHaveBeenCalled()
    expect(editorsHoldChanges()).toBe(false)
    off()
  })

  it('one with changes is asked; Save / Discard run it after, Keep editing never', async () => {
    const run = vi.fn()
    const dirty = editor(true, false)
    const off = registerOpenEditor(dirty)
    expect(editorsHoldChanges()).toBe(true)
    afterLeavingEditors(run)
    expect(run).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(dirty.ask).toHaveBeenCalled())
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    off()

    const left = editor(true, true)
    const off2 = registerOpenEditor(left)
    afterLeavingEditors(run)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    off2()
  })

  it('asks each editor holding changes in turn, stopping at the first Keep editing', async () => {
    const a = editor(true, false)
    const b = editor(true, true)
    const offA = registerOpenEditor(a)
    const offB = registerOpenEditor(b)
    expect(await leaveOpenEditors()).toBe(false)
    expect(b.ask).not.toHaveBeenCalled()
    offA()
    expect(await leaveOpenEditors()).toBe(true)
    offB()
  })
})

/** The stores' fields that say which editor is open: every state key named for an editor that isn't an action. */
function editorFields(): { store: 'ui' | 'charts'; key: string }[] {
  const of = (store: 'ui' | 'charts', state: object) => Object.entries(state)
    .filter(([key, value]) => /editor/i.test(key) && typeof value !== 'function')
    .map(([key]) => ({ store, key }))
  return [...of('ui', useUIStore.getState()), ...of('charts', useChartWidgetsStore.getState())]
}

const openEverywhere = () => {
  for (const { store, key } of editorFields()) {
    const value = key === 'listEditor' ? { listDefinitionId: 4, tabId: 'tab-l' } : `tab-${key}`
    if (store === 'ui') useUIStore.setState({ [key]: value })
    else useChartWidgetsStore.setState({ [key]: value })
  }
}
const openNow = () => editorFields().filter(({ store, key }) => (
  (store === 'ui' ? useUIStore.getState() : useChartWidgetsStore.getState()) as unknown as Record<string, unknown>)[key] != null).map(({ key }) => key)

describe('editor-leave: the one roster of open editors (M5 / A1)', () => {
  it('the fields it holds: Edit list, the Number editor, a chart’s, Project pulse’s, Created vs completed’s', () => {
    expect(editorFields().map(({ key }) => key).sort()).toEqual(['editorTabId', 'listEditor', 'numberEditorTabId', 'pulseEditorTabId', 'trendEditorTabId'])
  })

  it('closeOpenEditors closes every one of them: a new open-editor field has to be registered', () => {
    openEverywhere()
    expect(openNow()).toHaveLength(editorFields().length)
    closeOpenEditors()
    expect(openNow()).toEqual([])
  })

  it('one at a time, whichever store holds it: opening an editor closes any other', () => {
    useUIStore.getState().openNumberEditor('n')
    useChartWidgetsStore.getState().openEditor('c')
    expect(openNow()).toEqual(['editorTabId'])
    useChartWidgetsStore.getState().openPulseEditor('p')
    expect(openNow()).toEqual(['pulseEditorTabId'])
    useChartWidgetsStore.getState().openTrendEditor('t')
    expect(openNow()).toEqual(['trendEditorTabId'])
    useUIStore.getState().openListEditor(4, 'l')
    expect(openNow()).toEqual(['listEditor'])
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 4, tabId: 'l' })
    useUIStore.getState().openNumberEditor('n')
    expect(openNow()).toEqual(['numberEditorTabId'])
  })

  it('an editor with changes is asked before another opens; Keep editing opens nothing and closes nothing', async () => {
    useChartWidgetsStore.setState({ editorTabId: 'c' })
    const dirty = editor(true, false)
    const off = registerOpenEditor(dirty)
    useUIStore.getState().openNumberEditor('n')
    await vi.waitFor(() => expect(dirty.ask).toHaveBeenCalled())
    await Promise.resolve()
    expect(openNow()).toEqual(['editorTabId'])
    off()
  })

  it('opening Settings closes every unchanged editor, a chart’s too', () => {
    openEverywhere()
    useUIStore.getState().openSettings()
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(openNow()).toEqual([])
  })
})
