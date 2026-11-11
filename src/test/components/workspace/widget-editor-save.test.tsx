import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect } from 'react'
import { act, render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { ChartEditorHost } from '../../../components/workspace/glance/ChartEditor'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { NumberEditorHost } from '../../../components/workspace/glance/NumberEditor'
import { PulseEditorHost } from '../../../components/workspace/glance/PulseEditor'
import { SAVE_UNREADABLE_TITLE } from '../../../components/workspace/glance/editor-draft'
import { ConfirmPromptHost } from '../../../components/overlays/ConfirmPromptHost'
import { useAddWidget } from '../../../components/workspace/widget-hooks'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { createTab, type GlanceTab, type LayoutTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { useChartWidgetsStore } from '../../../stores/chart-widgets-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import { numberTab, single } from '../../helpers/layout-builders'
import { layoutSteps } from '../../helpers/layout-steps'

/**
 * The widget editors' Save / Discard (the Number's, a chart's, Project
 * pulse's): the editor edits a copy, drawn live in the widget; Save writes the changed keys once and
 * closes, Discard closes writing nothing; Esc, × or a press elsewhere close
 * at once while unchanged and ask Save / Discard / Keep editing otherwise;
 * Save is off while unchanged or while an expression doesn't read; a widget
 * added (its editor opened at once) stays on Discard.
 */

let add!: ReturnType<typeof useAddWidget>
function Adder() {
  const addWidget = useAddWidget()
  useEffect(() => { add = addWidget })
  return null
}

/** Every widget of the layout's one cell, as the layout holds it now. */
function Live() {
  const tabs = useWorkspaceStore((s) => s.working!.cells[0]!.tabs)
  return (
    <WidgetFaceContext.Provider value={{ forced: 'large' }}>
      {tabs.map((t) => <GlanceWidget key={t.id} tab={t as GlanceTab} />)}
    </WidgetFaceContext.Provider>
  )
}

const elsewhere = vi.fn()

function setup(...tabs: LayoutTab[]) {
  const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs }) }
  useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], writeFailed: false })
  return render(
    <DndContext>
      <Adder />
      <Live />
      <button type="button" onClick={elsewhere}>Elsewhere</button>
      <NumberEditorHost />
      <ChartEditorHost />
      <PulseEditorHost />
      <ConfirmPromptHost />
    </DndContext>,
  )
}

const tabs = () => useWorkspaceStore.getState().working!.cells[0]!.tabs
const stored = (id: string) => tabs().find((t) => t.id === id)!
const numberEditor = () => document.querySelector<HTMLElement>('[data-number-editor]')
const openNumber = (id = 'n') => {
  act(() => { useUIStore.getState().openNumberEditor(id) })
  return numberEditor()!
}
const saveButton = (editor: HTMLElement) => within(editor).getByRole('button', { name: 'Save' })
const nameField = (editor: HTMLElement) => within(editor).getByRole('textbox', { name: 'Name' })
const rename = (editor: HTMLElement, value: string) => fireEvent.change(nameField(editor), { target: { value } })
/** The close question on screen. */
const question = (title: string) => screen.getByRole('dialog', { name: title })
/** Answers the close question; its follow-up (a write, the close) lands after. */
async function answer(title: string, label: 'Save' | 'Discard' | 'Keep editing') {
  await act(async () => { fireEvent.click(within(question(title)).getByRole('button', { name: label })) })
}
const press = (el: Element) => {
  fireEvent.pointerDown(el)
  fireEvent.mouseDown(el)
  fireEvent.click(el)
}

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  elsewhere.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('a widget editor’s Save', () => {
  it('is off until something changes, and off again once it reads as stored', () => {
    setup(numberTab('n', 'overdue'))
    const editor = openNumber()
    expect(saveButton(editor)).toBeDisabled()
    expect(within(editor).getByRole('button', { name: 'Discard' })).toBeEnabled()
    rename(editor, 'Late')
    expect(saveButton(editor)).toBeEnabled()
    expect(editor).toHaveTextContent('Unsaved changes')
    rename(editor, 'Overdue')
    expect(saveButton(editor)).toBeDisabled()
  })

  it('writes the changed keys once, as one config update, and closes; the widget draws the edits live until then', () => {
    setup(numberTab('n', 'overdue'))
    const before = stored('n')
    const patchSpy = vi.spyOn(useWorkspaceStore.getState(), 'patchTabConfig')
    const editor = openNumber()
    rename(editor, 'Late')
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Compare with' }), { target: { value: 'none' } })
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Compare with' }), { target: { value: 'lastWeek' } })
    expect(stored('n')).toBe(before)
    expect(document.querySelector('[data-number="n"]')).toHaveTextContent('Late')
    expect(useWidgetPreviewStore.getState().configs.n).toMatchObject({ name: 'Late', compare: 'lastWeek' })
    fireEvent.click(saveButton(editor))
    expect(numberEditor()).toBeNull()
    expect(patchSpy).toHaveBeenCalledTimes(1)
    expect(patchSpy).toHaveBeenCalledWith('n', 'number', { name: 'Late', compare: 'lastWeek' }, 'Edited number “Late”')
    expect(stored('n')).toMatchObject({ config: { name: 'Late', compare: 'lastWeek' } })
    // Saved for good, as one undo step.
    expect(layoutSteps()).toEqual(['Edited number “Late”'])
    expect(document.querySelector('[data-number="n"]')).toHaveTextContent('Late')
    expect(useWidgetPreviewStore.getState().configs).toEqual({})
  })

  it('is off while a filter expression doesn’t read, saying why', () => {
    setup(numberTab('n', 'overdue'))
    const editor = openNumber()
    const filter = within(editor).getByTestId('number-editor-filter')
    fireEvent.click(within(filter).getByRole('radio', { name: 'Expression' }))
    expect(saveButton(editor)).toBeEnabled()
    fireEvent.change(within(filter).getByRole('textbox', { name: 'Filter expression' }), { target: { value: 'overdue and (' } })
    expect(saveButton(editor)).toBeDisabled()
    expect(saveButton(editor)).toHaveAttribute('title', SAVE_UNREADABLE_TITLE)
  })
})

describe('a widget editor’s Discard', () => {
  it('closes and writes nothing; the widget is as stored again', () => {
    setup(numberTab('n', 'overdue'))
    const before = stored('n')
    const patchSpy = vi.spyOn(useWorkspaceStore.getState(), 'patchTabConfig')
    const editor = openNumber()
    rename(editor, 'Late')
    expect(document.querySelector('[data-number="n"]')).toHaveTextContent('Late')
    fireEvent.click(within(editor).getByRole('button', { name: 'Discard' }))
    expect(numberEditor()).toBeNull()
    expect(document.querySelector('[data-number="n"]')).toHaveTextContent('Overdue')
    expect(useWidgetPreviewStore.getState().configs).toEqual({})
    expect(patchSpy).not.toHaveBeenCalled()
    expect(stored('n')).toBe(before)
    expect(layoutSteps()).toEqual([])
    // Nothing kept: it opens on the stored config again.
    expect(nameField(openNumber())).toHaveValue('Overdue')
  })

  it('Project pulse’s: a rule edit dropped', () => {
    const pulse = createTab('pulse', 'p', { tagIds: [1] })
    setup(pulse)
    act(() => { useChartWidgetsStore.getState().openPulseEditor('p') })
    const editor = document.querySelector<HTMLElement>('[data-pulse-editor="p"]')!
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Late name' }), { target: { value: 'behind' } })
    fireEvent.click(within(editor).getByRole('button', { name: 'Discard' }))
    expect(document.querySelector('[data-pulse-editor]')).toBeNull()
    expect(stored('p').config).toEqual({ tagIds: [1] })
  })
})

describe('closing a widget editor', () => {
  it('changed, opening Settings or another widget’s editor asks first (the one rule, `editor-leave`); Save writes, then it goes on', async () => {
    setup(numberTab('n', 'overdue'))
    const title = 'Save changes to number “Overdue”?'
    rename(openNumber(), 'Late')
    act(() => { useUIStore.getState().openSettings() })
    expect(question(title)).toBeInTheDocument()
    expect(useUIStore.getState().settingsOpen).toBe(false)
    await answer(title, 'Keep editing')
    expect(numberEditor()).not.toBeNull()
    expect(useUIStore.getState().settingsOpen).toBe(false)
    act(() => { useUIStore.getState().openSettings() })
    await answer(title, 'Save')
    expect(stored('n')).toMatchObject({ config: { name: 'Late' } })
    expect(useUIStore.getState().settingsOpen).toBe(true)
    expect(numberEditor()).toBeNull()
  })

  it('changed, closed from outside (its widget gone) says its changes weren’t saved', () => {
    setup(numberTab('n', 'overdue'))
    rename(openNumber(), 'Late')
    act(() => { useUIStore.getState().closeNumberEditor() })
    expect(numberEditor()).toBeNull()
    expect(useUndoStore.getState().snackbar?.description).toContain('weren’t saved')
  })

  it('unchanged, Esc, × and a press elsewhere close it at once, asking nothing (the press goes on)', () => {
    setup(numberTab('n', 'overdue'))
    fireEvent.keyDown(nameField(openNumber()), { key: 'Escape' })
    expect(numberEditor()).toBeNull()
    fireEvent.click(within(openNumber()).getByRole('button', { name: 'Close' }))
    expect(numberEditor()).toBeNull()
    openNumber()
    press(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(numberEditor()).toBeNull()
    expect(elsewhere).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
  })

  it('changed, Esc asks Save / Discard / Keep editing: Keep editing keeps the edits, Discard drops them', async () => {
    setup(numberTab('n', 'overdue'))
    const editor = openNumber()
    rename(editor, 'Late')
    fireEvent.keyDown(nameField(editor), { key: 'Escape' })
    const title = 'Save changes to number “Overdue”?'
    const dialog = question(title)
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent?.replace('Esc', '').trim())).toEqual(expect.arrayContaining(['Save', 'Discard', 'Keep editing']))
    await answer(title, 'Keep editing')
    expect(numberEditor()).not.toBeNull()
    expect(nameField(numberEditor()!)).toHaveValue('Late')
    expect(stored('n')).toMatchObject({ config: { name: 'Overdue' } })
    fireEvent.keyDown(nameField(numberEditor()!), { key: 'Escape' })
    await answer(title, 'Discard')
    expect(numberEditor()).toBeNull()
    expect(stored('n')).toMatchObject({ config: { name: 'Overdue' } })
    expect(layoutSteps()).toEqual([])
  })

  it('changed, × asks; its Save writes the edits and closes', async () => {
    setup(numberTab('n', 'overdue'))
    const editor = openNumber()
    rename(editor, 'Late')
    fireEvent.click(within(editor).getByRole('button', { name: 'Close' }))
    await answer('Save changes to number “Overdue”?', 'Save')
    expect(numberEditor()).toBeNull()
    expect(stored('n')).toMatchObject({ config: { name: 'Late' } })
    expect(layoutSteps()).not.toEqual([])
  })

  it('changed, a press elsewhere asks and goes no further; a press on the widget it edits is inside', async () => {
    setup(numberTab('n', 'overdue'))
    const editor = openNumber()
    rename(editor, 'Late')
    press(document.querySelector('[data-number-body="n"]')!)
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    press(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(elsewhere).not.toHaveBeenCalled()
    const title = 'Save changes to number “Overdue”?'
    expect(question(title)).toBeInTheDocument()
    // A press in the question is its own, not the editor's elsewhere.
    await answer(title, 'Keep editing')
    expect(useUIStore.getState().confirmPrompts).toHaveLength(0)
    expect(numberEditor()).not.toBeNull()
  })

  it('a chart’s question names its kind and name', async () => {
    setup(createTab('breakdown', 'b'))
    act(() => { useChartWidgetsStore.getState().openEditor('b') })
    const editor = document.querySelector<HTMLElement>('[data-chart-editor="b"]')!
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Style' }), { target: { value: 'donut' } })
    fireEvent.keyDown(within(editor).getByRole('combobox', { name: 'Style' }), { key: 'Escape' })
    const name = (stored('b').config as { name: string }).name
    await answer(`Save changes to breakdown “${name}”?`, 'Discard')
    expect(document.querySelector('[data-chart-editor]')).toBeNull()
    expect(stored('b').config).not.toHaveProperty('style', 'donut')
  })
})

describe('Add widget opens no editor (decision 8)', () => {
  it.each(['number', 'breakdown', 'pivot', 'pulse'] as const)('a new %s is added with its first config and no editor', (kind) => {
    setup(numberTab('n', 'overdue'))
    let id: string | null = null
    act(() => { id = add(kind, { kind: 'cell', cellId: 'c' }) })
    expect(id).not.toBeNull()
    expect(stored(id!).kind).toBe(kind)
    expect(numberEditor()).toBeNull()
    expect(document.querySelector('[data-chart-editor]')).toBeNull()
    expect(useUIStore.getState().numberEditorTabId).toBeNull()
    expect(useChartWidgetsStore.getState()).toMatchObject({ editorTabId: null, pulseEditorTabId: null })
  })
})
