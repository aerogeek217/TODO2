import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { WidgetKindMenu } from '../../../components/shared/WidgetKindMenu'
import { useDashboardMenuActions } from '../../../components/workspace/dashboard/dashboard-menu'
import type { DashboardSummary } from '../../../components/workspace/glance/glance-summary'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { makeTodo, resetDb } from '../../helpers'

const SUMMARY: DashboardSummary = { plain: 'Open 3 · Focus 2', html: '<p><b>Open</b> 3 · <b>Focus</b> 2</p>' }

function Harness({ onCustomize, onClose, summary }: { onCustomize: () => void; onClose: () => void; summary?: DashboardSummary }) {
  const actions = useDashboardMenuActions({ onCustomize, summary })
  return <WidgetKindMenu anchor={{ x: 10, y: 20 }} currentKind="dashboard" onChangeKind={() => {}} onClose={onClose} widgetActions={actions} />
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard')
let write: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useSettingsStore.setState({ urgentDueWithinDays: 3 })
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
  it('lists Customize dashboard…, Copy summary, then Change widget', () => {
    render(<Harness onCustomize={() => {}} onClose={() => {}} summary={SUMMARY} />)
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(labels.slice(0, 2)).toEqual(['Customize dashboard…', 'Copy summary'])
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
    expect(await item.data['text/plain']!.text()).toBe('Open 3 · Focus 2')
    expect(await item.data['text/html']!.text()).toContain('<p><b>Open</b> 3 · <b>Focus</b> 2</p>')
  })

})
