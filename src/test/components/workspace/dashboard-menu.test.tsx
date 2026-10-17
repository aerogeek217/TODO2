import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { WidgetKindMenu } from '../../../components/shared/WidgetKindMenu'
import { useDashboardMenuActions } from '../../../components/workspace/dashboard/dashboard-menu'
import type { DashboardSummary } from '../../../components/workspace/dashboard/dashboard-summary'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makeTodo, resetDb } from '../../helpers'

const SUMMARY: DashboardSummary = { plain: 'Open 3 · Hot 2', html: '<p><b>Open</b> 3 · <b>Hot</b> 2</p>' }

function Harness({ onCustomize, onClose, summary }: { onCustomize: () => void; onClose: () => void; summary?: DashboardSummary }) {
  const actions = useDashboardMenuActions({ onCustomize, summary })
  return <WidgetKindMenu anchor={{ x: 10, y: 20 }} currentKind="dashboard" onChangeKind={() => {}} onClose={onClose} widgetActions={actions} />
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
let write: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useSettingsStore.setState({ hotRule: DEFAULT_HOT_RULE, urgentDueWithinDays: 3 })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, urgent: true, important: true }),
      makeTodo({ id: 2, urgent: true }),
      makeTodo({ id: 3, focus: true }),
      makeTodo({ id: 4, important: true }),
    ],
  })
  write = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { write, writeText: vi.fn() } })
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (clipboardDescriptor) Object.defineProperty(globalThis.navigator, 'clipboard', clipboardDescriptor)
  else delete (globalThis.navigator as { clipboard?: unknown }).clipboard
})

describe('Dashboard tab menu', () => {
  it('lists Customize dashboard…, Hot is (the rule at a glance), Copy summary, then Change widget', () => {
    render(<Harness onCustomize={() => {}} onClose={() => {}} summary={SUMMARY} />)
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(labels.slice(0, 3)).toEqual(['Customize dashboard…', 'Hot isU+I or Focus', 'Copy summary'])
    expect(screen.getAllByRole('menuitemradio')[0]).toHaveTextContent('List')
  })

  it('Copy summary is offered only once the widget has reported its counts', () => {
    render(<Harness onCustomize={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('menuitem', { name: 'Copy summary' })).toBeNull()
  })

  it('Customize dashboard… opens the dialog and closes the menu', () => {
    const onCustomize = vi.fn()
    const onClose = vi.fn()
    render(<Harness onCustomize={onCustomize} onClose={onClose} summary={SUMMARY} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Customize dashboard…' }))
    expect(onCustomize).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Copy summary writes the counts to the clipboard as rich text and plain text', async () => {
    render(<Harness onCustomize={() => {}} onClose={() => {}} summary={SUMMARY} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy summary' }))
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    const item = (write.mock.calls[0]![0] as Array<{ data: Record<string, Blob> }>)[0]!
    expect(await item.data['text/plain']!.text()).toBe('Open 3 · Hot 2')
    expect(await item.data['text/html']!.text()).toContain('<p><b>Open</b> 3 · <b>Hot</b> 2</p>')
  })

  it('Hot is › opens the app-wide rule editor: changes save at once and update the count and the menu item', async () => {
    render(<Harness onCustomize={() => {}} onClose={() => {}} summary={SUMMARY} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Hot is/ }))
    const panel = screen.getByRole('dialog', { name: 'Hot rule' })
    expect(panel).toHaveTextContent('Hot when a task has everything on any line')
    expect(panel).toHaveTextContent('One rule for the whole app; also in Settings › Task Defaults.')
    // No per-line counts in the flyout; the total sits beside + Or….
    expect(panel.textContent).not.toMatch(/\d now/)
    expect(within(panel).getByTestId('hot-rule-total')).toHaveTextContent('2 hot now')

    // Line 1 without Important: Urgent OR Focus.
    fireEvent.click(within(within(panel).getByRole('group', { name: 'Hot rule line 1' })).getByRole('button', { name: /Important/ }))
    await waitFor(() => expect(useSettingsStore.getState().hotRule).toEqual([{ urgent: true }, { focus: true }]))
    expect(within(panel).getByTestId('hot-rule-total')).toHaveTextContent('3 hot now')
    expect(screen.getByRole('menuitem', { name: /Hot is/ })).toHaveTextContent('Urgent or Focus')
  })
})
