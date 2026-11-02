import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PersonCheckinMenu } from '../../../components/shared/PersonCheckinMenu'
import { db } from '../../../data/database'
import { emptyPredicate, type Person, type PersistedTodoItem } from '../../../models'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../../utils/followup'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { makePerson, makeTodo } from '../../helpers'

/**
 * The envelope's menu: Send runs the one-click send inside the item's click
 * (the clipboard write starts before the click returns — the gesture), Paste
 * reply opens the check-in reply import; either hands the focus back to the
 * envelope first.
 */

const ada = makePerson({ id: 1, name: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com' })
const TODOS: PersistedTodoItem[] = [
  makeTodo({ id: 1, uid: '11111111-0000-4000-8000-000000000001', title: 'Ada task' }),
]
const ASSIGNED = new Map<number, Person[]>([[1, [ada]]])

let write: ReturnType<typeof vi.fn>
let mailto: string[]

beforeEach(async () => {
  await db.delete()
  await db.open()
  await db.people.bulkAdd([ada])
  await db.todos.bulkAdd(TODOS)
  useTodoStore.setState({ todos: TODOS })
  usePersonStore.setState({ people: [ada], assignedPeopleMap: ASSIGNED })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  useStatusStore.setState({ statuses: [] })
  useSettingsStore.setState({
    checkinOpenMethod: 'mailto', checkinTaskFilter: emptyPredicate(), weekStartsOn: 1,
    urgentDueWithinDays: 0, hotRule: DEFAULT_HOT_RULE, followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL,
  })
  useUIStore.setState({ checkinDialog: null, checkinImportOpen: false })
  useUndoStore.getState().clear()
  write = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText: vi.fn(async () => {}) } })
  vi.stubGlobal('ClipboardItem', class { constructor(public data: Record<string, Blob>) {} })
  mailto = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    mailto.push(this.getAttribute('href') ?? '')
  })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'clipboard')
  useUndoStore.getState().clear()
})

function Envelope() {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Envelope</button>
      {open && <PersonCheckinMenu person={{ id: 1, name: 'Ada Lovelace' }} anchorRef={ref} onClose={() => setOpen(false)} />}
    </>
  )
}

function openMenu(): HTMLElement {
  render(<Envelope />)
  const envelope = screen.getByRole('button', { name: 'Envelope' })
  envelope.focus()
  fireEvent.click(envelope)
  return screen.getByRole('menu', { name: 'Check-in for Ada Lovelace' })
}

describe('PersonCheckinMenu', () => {
  it('offers Send check-in and Paste reply, focus on the first', () => {
    const menu = openMenu()
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'))
    expect(items.map((i) => i.textContent)).toEqual(['Send check-in to Ada Lovelace', 'Paste reply from Ada Lovelace…'])
    expect(document.activeElement).toBe(items[0])
  })

  it('Send runs the send inside the click — the clipboard write has started when the click returns — then opens the mail link', async () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send check-in to Ada Lovelace' }))
    // Before any await: the write rides the click's user activation.
    expect(write).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Envelope' }))
    await vi.waitFor(() => expect(mailto).toEqual(['mailto:ada@example.com?subject=Task%20check-in%3A%201%20open%20task']))
    await vi.waitFor(() => expect(useUndoStore.getState().snackbar?.description).toBe('Check-in for Ada Lovelace opened · 1 task followed up'))
    expect(useUIStore.getState().checkinDialog).toBeNull()
    expect(useUIStore.getState().checkinImportOpen).toBe(false)
  })

  it('Paste reply opens the check-in reply import, sending nothing; the focus is back on the envelope', () => {
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste reply from Ada Lovelace…' }))
    expect(useUIStore.getState().checkinImportOpen).toBe(true)
    expect(useUIStore.getState().checkinImportPersonId).toBe(1)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Envelope' }))
    expect(write).not.toHaveBeenCalled()
    expect(mailto).toEqual([])
  })
})
