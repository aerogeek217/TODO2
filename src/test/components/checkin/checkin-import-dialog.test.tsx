import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CheckinDialog } from '../../../components/checkin/CheckinDialog'
import { CheckinImportDialog } from '../../../components/checkin/CheckinImportDialog'
import { db } from '../../../data/database'
import type { PersistedTodoItem } from '../../../models'
import { emptyPredicate } from '../../../models/filter-predicate'
import { CHECKIN_REPLY_MAX_CHARS } from '../../../services/checkin-reply/parse'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { DEFAULT_FOLLOWUP_INTERVAL } from '../../../utils/followup'
import { checkinSampleStatusUpdates, checkinSampleTasks } from '../../fixtures/checkin-replies/sample-tasks'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { makePerson } from '../../helpers'
import { editHtml, editPlain, marcus, sampleEmail } from '../../services/checkin-reply/helpers'

const fixtures = import.meta.glob('../../fixtures/checkin-replies/synthetic-new-outlook-inline.*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const fixture = (ext: string) => Object.entries(fixtures).find(([p]) => p.endsWith(ext))?.[1] ?? ''

// Tue 13 Oct 2026, 11:00 — the day after the sample email was sent.
const NOW = new Date(2026, 9, 13, 11)
const ada = makePerson({ id: 2, name: 'Ada Lovelace', initials: 'AL' })

let tasks: PersistedTodoItem[]

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  await db.delete()
  await db.open()
  tasks = checkinSampleTasks()
  await db.todos.bulkAdd(tasks)
  await db.statusUpdates.bulkAdd([...checkinSampleStatusUpdates().values()].flat())
  await useStatusUpdateStore.getState().load()
  await db.people.bulkAdd([marcus, ada])
  useTodoStore.setState({ todos: tasks, todosVersion: 0 })
  usePersonStore.setState({ people: [marcus, ada], assignedPeopleMap: new Map(tasks.map((t) => [t.id, [marcus]])) })
  useSettingsStore.setState({ followupDefaultInterval: DEFAULT_FOLLOWUP_INTERVAL, defaultStatusId: null })
  useUIStore.setState({ checkinImportOpen: false, checkinDialog: null })
  useUndoStore.getState().clear()
})

afterEach(() => {
  cleanup()
  useUndoStore.getState().clear()
  vi.useRealTimers()
})

const dialog = () => screen.getByRole('dialog', { name: 'Import task update' })
const card = (title: string) => within(dialog()).getByRole('region', { name: title })
const applyButton = () => within(dialog()).getByRole('button', { name: /^Apply (\d+ )?changes?$/ })

function open() {
  render(<CheckinImportDialog />)
  act(() => useUIStore.getState().openCheckinImport())
}

function paste(input: { html?: string; plain: string }) {
  const target = within(dialog()).getByRole('textbox', { name: 'Paste the reply here' })
  fireEvent.paste(target, {
    clipboardData: {
      getData: (type: string) => (type === 'text/html' ? input.html ?? '' : type === 'text/plain' ? input.plain : ''),
    },
  })
}

describe('CheckinImportDialog — reading a paste', () => {
  it('shows the paste target first, focused', () => {
    open()
    const target = within(dialog()).getByRole('textbox', { name: 'Paste the reply here' })
    expect(target).toHaveProperty('placeholder', 'Paste the reply here (Ctrl+V)')
    expect(document.activeElement).toBe(target)
    expect(applyButton()).toHaveProperty('disabled', true)
  })

  it('a reply: who replied, the counts, one card per changed task, every change ticked', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    expect(within(dialog()).getByText('Reply from Marcus Chen')).toBeTruthy()
    expect(within(dialog()).getByText('4 of 4 tasks matched by Ref · 3 changes found')).toBeTruthy()

    const status = card('Answer Northwind’s security questionnaire')
    expect(within(status).getByRole('checkbox', { name: 'Status' })).toHaveProperty('checked', true)
    expect(status.querySelector('[data-checkin-status-update]')?.textContent).toBe('New status update · todaysection 4 doneNewest now: 10/10 · half done')
    const done = card('Review the staging load-test results')
    expect(within(done).getByRole('checkbox', { name: 'Completed' })).toHaveProperty('checked', true)
    expect(done.textContent).toContain('Mark complete')
    const notes = card('Draft the migration runbook')
    const lines = Array.from(notes.querySelectorAll('[data-op]')).map((l) => `${l.getAttribute('data-op')} ${l.lastElementChild?.textContent}`)
    expect(lines).toEqual([
      '= Cover the cutover sequence, rollback steps and who is on call.',
      '+ Added: Nina confirmed Saturday 06:00–08:00 for the cutover.',
      '= - Link the existing **DB checklist**',
      '~ Edited: - removed Ask Nina aboutadded Agreed the [rollback window](https://example.com/runbook) added with Nina',
      '= - [ ] Dry run on staging',
    ])

    // Task 4 came back unchanged: no card, one line.
    expect(within(dialog()).queryByRole('region', { name: /Contoso/ })).toBeNull()
    expect(dialog().querySelector('[data-checkin-unchanged]')?.textContent).toContain('No changes in 1 other task')
    expect(within(dialog()).getByRole('checkbox', { name: /Record a follow-up/ })).toHaveProperty('checked', true)
    expect(applyButton().textContent).toBe('Apply 3 changes')
    expect(applyButton()).toHaveProperty('disabled', false)
  })

  it('Record a follow-up says what Mark followed up does to the next follow-up: today + the interval, or cleared while that is off', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    const label = () => within(dialog()).getByRole('checkbox', { name: /Record a follow-up/ }).closest('label')!
    expect(label().textContent).toContain('(Last follow-up → today; Next follow-up → today + 1 month, the same as “Mark followed up”)')
    act(() => useSettingsStore.setState({ autoFollowup: false }))
    expect(label().textContent).toContain('(Last follow-up → today; Next follow-up cleared, the same as “Mark followed up”)')
  })

  it('the Apply count follows the ticks', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    fireEvent.click(within(card('Draft the migration runbook')).getByRole('checkbox', { name: 'Notes' }))
    expect(applyButton().textContent).toBe('Apply 2 changes')
    fireEvent.click(within(card('Review the staging load-test results')).getByRole('checkbox', { name: 'Completed' }))
    fireEvent.click(within(card('Answer Northwind’s security questionnaire')).getByRole('checkbox', { name: 'Status' }))
    expect(applyButton().textContent).toBe('Apply 0 changes')
    expect(applyButton()).toHaveProperty('disabled', true)
  })

  it('a task changed in the app since the email: no warning, its rows ticked, no stale count (no timestamps)', () => {
    useTodoStore.setState({ todos: tasks.map((t) => (t.id === 1 ? { ...t, modifiedAt: new Date(2026, 9, 13, 8) } : t)) })
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    const changed = card('Answer Northwind’s security questionnaire')
    expect(changed.textContent).not.toMatch(/since this email|Check before applying/)
    expect(within(changed).getByRole('checkbox', { name: 'Status' })).toHaveProperty('checked', true)
    expect(within(dialog()).getByText('4 of 4 tasks matched by Ref · 3 changes found')).toBeTruthy()
    expect(applyButton().textContent).toBe('Apply 3 changes')
  })

  it('the footer’s send date shows as information', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    expect(within(dialog()).getByText('The person comes from the email’s “Check-in for …” footer, sent Oct 12.')).toBeTruthy()
  })

  it('a task already completed in the app: listed, nothing to apply', () => {
    useTodoStore.setState({ todos: tasks.map((t) => (t.id === 4 ? { ...t, isCompleted: true, completedAt: new Date(2026, 9, 12, 15) } : t)) })
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    const c = card('Renew the Contoso support contract — confirm pricing tier & seats (<50 users?)')
    expect(c.textContent).toContain('Already completed in the app. Nothing to apply.')
    expect(within(c).queryByRole('checkbox')).toBeNull()
  })

  it('a task not assigned to the person who replied (a forwarded email): a note, its rows unticked', () => {
    usePersonStore.setState({ assignedPeopleMap: new Map(tasks.map((t) => [t.id, t.id === 1 ? [ada] : [marcus]])) })
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    const other = card('Answer Northwind’s security questionnaire')
    expect(other.textContent).toContain('Not assigned to Marcus Chen. Check before applying.')
    expect(within(other).getByRole('checkbox', { name: 'Status' })).toHaveProperty('checked', false)
    // Still matched and offered: a tick applies it.
    expect(applyButton().textContent).toBe('Apply 2 changes')
    fireEvent.click(within(other).getByRole('checkbox', { name: 'Status' }))
    expect(applyButton().textContent).toBe('Apply 3 changes')
    expect(card('Review the staging load-test results').textContent).not.toContain('Not assigned')
  })

  it('emptied notes: a warning, unticked', () => {
    const email = sampleEmail()
    open()
    paste({ html: editHtml(email.html, '0c4d8e17', 'Notes:', '&nbsp;'), plain: email.plain })
    const c = card('Answer Northwind’s security questionnaire')
    expect(c.textContent).toContain('The reply’s Notes are empty: applying removes the task’s notes.')
    expect(within(c).getByRole('checkbox', { name: 'Notes' })).toHaveProperty('checked', false)
  })

  it('pasted HTML is shown as text only', () => {
    const email = sampleEmail()
    open()
    paste({
      html: editHtml(email.html, '0c4d8e17', 'Notes:', '<p>Sections 4 and 7 still open.</p><img src="x" onerror="alert(1)"><script>alert(2)</script><p>&lt;b&gt;hi&lt;/b&gt; <a href="javascript:alert(3)">link</a></p>'),
      plain: email.plain,
    })
    expect(dialog().querySelector('img, script, a[href^="javascript"], b')).toBeNull()
    expect(card('Answer Northwind’s security questionnaire').textContent).toContain('<b>hi</b>')
  })

  it('refs that match nothing are listed', () => {
    const email = sampleEmail()
    open()
    paste({ plain: email.plain.replace('Ref 9e8d7c6b', 'Ref ffffffff') })
    expect(dialog().querySelector('[data-checkin-unmatched]')?.textContent)
      .toBe('Not found: ffffffff “Renew the Contoso support contract — confirm pricing tier & seats (<50 users?)”')
  })

  it('too large: an error, the paste target stays', () => {
    open()
    paste({ plain: 'x'.repeat(CHECKIN_REPLY_MAX_CHARS + 1) })
    expect(within(dialog()).getByRole('alert').textContent).toBe('This paste is too large to read (over 2 MB). Copy just the reply and paste again.')
    expect(within(dialog()).getByRole('textbox', { name: 'Paste the reply here' })).toBeTruthy()
  })

  it('no task in the paste: an error', () => {
    open()
    paste({ html: '<p>Thanks!</p>', plain: 'Thanks!' })
    expect(within(dialog()).getByRole('alert').textContent).toMatch(/^No task updates were found/)
  })

  it('Paste again goes back to the paste target', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Paste again' }))
    expect(within(dialog()).getByRole('textbox', { name: 'Paste the reply here' })).toBeTruthy()
    expect(applyButton()).toHaveProperty('disabled', true)
  })
})

describe('CheckinImportDialog — the preview', () => {
  /** A mark's visible text (its visually hidden label left out). */
  const visible = (el: Element) => Array.from(el.childNodes).filter((n) => !(n instanceof HTMLElement && n.className.includes('srOnly'))).map((n) => n.textContent).join('')

  it('a status update: the new text dated today, the newest now under it', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    const row = card('Answer Northwind’s security questionnaire').querySelector('[data-checkin-status-update]')
    if (!row) throw new Error('no status update row')
    expect(Array.from(row.children).map((c) => c.textContent)).toEqual([
      'New status update · today',
      'section 4 done',
      'Newest now: 10/10 · half done',
    ])
    expect(row.querySelector('del, ins')).toBeNull()
  })

  it('a status update on a task with none: no Newest now line', () => {
    const email = sampleEmail()
    open()
    paste({ plain: editPlain(email.plain, '3f9a1c42', 'Status:', ['Status: drafted, in review']) })
    const row = card('Draft the migration runbook').querySelector('[data-checkin-status-update]')
    expect(Array.from(row?.children ?? []).map((c) => c.textContent)).toEqual(['New status update · today', 'drafted, in review'])
    expect(row?.querySelector('[data-checkin-status-newest]')).toBeNull()
  })

  it('notes: an edited line is one redlined line; whole adds and removes keep their look', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    const notes = card('Draft the migration runbook')
    const edited = notes.querySelector('[data-op="~"]')
    if (!edited) throw new Error('no edited line')
    expect(Array.from(edited.querySelectorAll('del')).map(visible)).toEqual(['Ask Nina about'])
    expect(Array.from(edited.querySelectorAll('ins')).map(visible)).toEqual(['Agreed', 'with Nina'])
    // The pair replaced its − and + lines.
    expect(notes.querySelector('[data-op="-"]')).toBeNull()
    expect(notes.querySelectorAll('[data-op="+"]')).toHaveLength(1)
    expect(notes.querySelector('[data-op="+"] ins, [data-op="+"] del')).toBeNull()
  })
})

describe('CheckinImportDialog — who replied', () => {
  /** The sample email as plain text with task 2 marked done, footer removed. */
  function noFooter(): string {
    const email = sampleEmail()
    return editPlain(email.plain, 'b71e05d9', 'Completed:', ['Completed: [x]'])
      .split('\n').filter((l) => !l.startsWith('Check-in for')).join('\n')
  }

  it('no footer: Apply waits for a person; no send-date note', () => {
    open()
    paste({ plain: noFooter() })
    expect(within(dialog()).getByText('No “Check-in for …” footer was found. Choose who replied.')).toBeTruthy()
    expect(dialog().textContent).not.toMatch(/send date|since the email/)
    expect(applyButton().textContent).toBe('Apply 1 change')
    expect(applyButton()).toHaveProperty('disabled', true)
    expect(applyButton().title).toBe('Choose who replied first')

    fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Reply from' }), { target: { value: String(marcus.id) } })
    expect(applyButton()).toHaveProperty('disabled', false)
    expect(applyButton().textContent).toBe('Apply 1 change')
  })

  it('no footer: picking someone the tasks aren’t assigned to unticks their changes, with the note', () => {
    open()
    paste({ plain: noFooter() })
    fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Reply from' }), { target: { value: String(ada.id) } })
    const done = card('Review the staging load-test results')
    expect(done.textContent).toContain('Not assigned to Ada Lovelace. Check before applying.')
    expect(within(done).getByRole('checkbox', { name: 'Completed' })).toHaveProperty('checked', false)
    expect(applyButton().title).toBe('Nothing is ticked')
  })

  it('no footer: switching who replied re-derives the ticks and notes, but a tick changed by hand stays', () => {
    open()
    paste({ plain: noFooter() })
    const pick = (id: number) => fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Reply from' }), { target: { value: String(id) } })
    const done = () => card('Review the staging load-test results')
    const completed = () => within(done()).getByRole('checkbox', { name: 'Completed' })

    pick(ada.id)
    expect(completed()).toHaveProperty('checked', false)
    // Marcus, whose task it is: ticked again, no note.
    pick(marcus.id)
    expect(completed()).toHaveProperty('checked', true)
    expect(done().textContent).not.toContain('Not assigned to')
    expect(applyButton().textContent).toBe('Apply 1 change')

    // Unticked by hand, then back to Ada and Marcus: it stays unticked.
    fireEvent.click(completed())
    pick(ada.id)
    expect(done().textContent).toContain('Not assigned to Ada Lovelace. Check before applying.')
    pick(marcus.id)
    expect(completed()).toHaveProperty('checked', false)
    // Ticked by hand while Ada is picked: it stays ticked.
    pick(ada.id)
    fireEvent.click(completed())
    pick(marcus.id)
    pick(ada.id)
    expect(completed()).toHaveProperty('checked', true)
  })

  it('a footer name that is not one of your people: the picker, with the name', () => {
    const email = sampleEmail()
    open()
    paste({ plain: email.plain.replace('Check-in for Marcus Chen', 'Check-in for Marcus Chan') })
    expect(within(dialog()).getByText('The footer names “Marcus Chan”, who isn’t one of your people. Choose who replied.')).toBeTruthy()
    expect(within(dialog()).getByRole('combobox', { name: 'Reply from' })).toBeTruthy()
  })

  it('opened for a person (Paste reply from …): with no footer they are who replied, changeable', () => {
    render(<CheckinImportDialog />)
    act(() => useUIStore.getState().openCheckinImport({ personId: marcus.id }))
    paste({ plain: noFooter() })
    const select = within(dialog()).getByRole('combobox', { name: 'Reply from' }) as HTMLSelectElement
    expect(select.value).toBe(String(marcus.id))
    expect(within(dialog()).getByText('No “Check-in for …” footer was found. It’s taken as Marcus Chen’s reply — change it if someone else replied.')).toBeTruthy()
    expect(applyButton()).toHaveProperty('disabled', false)
    // The ticks follow Marcus (the task is his): ticked.
    expect(within(card('Review the staging load-test results')).getByRole('checkbox', { name: 'Completed' })).toHaveProperty('checked', true)
    fireEvent.change(select, { target: { value: String(ada.id) } })
    expect(within(dialog()).getByText('No “Check-in for …” footer was found. Choose who replied.')).toBeTruthy()
    expect(card('Review the staging load-test results').textContent).toContain('Not assigned to Ada Lovelace.')
  })

  it('opened for a person: the footer still wins when it names one of your people', () => {
    render(<CheckinImportDialog />)
    act(() => useUIStore.getState().openCheckinImport({ personId: ada.id }))
    paste({ plain: sampleEmail().plain })
    expect(within(dialog()).getByText('Reply from Marcus Chen')).toBeTruthy()
    expect(within(dialog()).queryByRole('combobox', { name: 'Reply from' })).toBeNull()
  })

  it('opened for a person no longer in your people: nobody chosen', () => {
    render(<CheckinImportDialog />)
    act(() => useUIStore.getState().openCheckinImport({ personId: 999 }))
    paste({ plain: noFooter() })
    expect((within(dialog()).getByRole('combobox', { name: 'Reply from' }) as HTMLSelectElement).value).toBe('')
    expect(applyButton().title).toBe('Choose who replied first')
  })

  it('the footer name matches a person regardless of case and spacing', () => {
    const email = sampleEmail()
    open()
    paste({ plain: email.plain.replace('Check-in for Marcus Chen', 'Check-in for marcus   CHEN') })
    expect(within(dialog()).getByText('Reply from Marcus Chen')).toBeTruthy()
  })
})

describe('CheckinImportDialog — apply', () => {
  it('applies the ticked changes, closes, and shows the undo snackbar; Undo restores the old notes', async () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    fireEvent.click(within(card('Answer Northwind’s security questionnaire')).getByRole('checkbox', { name: 'Status' }))
    fireEvent.click(applyButton())

    await waitFor(() => expect(useUIStore.getState().checkinImportOpen).toBe(false))
    const t = (id: number) => useTodoStore.getState().todos.find((x) => x.id === id)!
    expect(useStatusUpdateStore.getState().byTodo.get(1)?.map((u) => u.text)).toEqual(['half done'])
    expect(t(2).isCompleted).toBe(true)
    expect(t(3).notes).toContain('Nina confirmed Saturday')
    expect(t(1).lastFollowupAt).toBeUndefined()
    expect(t(2).lastFollowupAt).toEqual(NOW)
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Applied 2 changes from Marcus Chen' })

    await act(() => useUndoStore.getState().undo())
    expect(t(3).notes).toBe(tasks[2]?.notes)
    expect((await db.todos.get(3))?.notes).toBe(tasks[2]?.notes)
    expect(t(2).isCompleted).toBe(false)
    expect(t(2).lastFollowupAt).toBeUndefined()
  })

  it('Cancel and Esc close without writing', () => {
    open()
    paste({ html: fixture('.html'), plain: fixture('.txt') })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useUndoStore.getState().undoStack).toHaveLength(0)

    act(() => useUIStore.getState().openCheckinImport())
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('entry points', () => {
  it('the check-in dialog footer has Paste a reply…, which swaps to the import dialog', () => {
    useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
    useStatusStore.setState({ statuses: [] })
    useListDefinitionStore.setState({ listDefinitions: [] })
    useSettingsStore.setState({ checkinOpenMethod: 'mailto', checkinTaskFilter: emptyPredicate(), weekStartsOn: 1, urgentDueWithinDays: 0 })
    render(<><CheckinDialog /><CheckinImportDialog /></>)
    act(() => useUIStore.getState().openCheckinDialog())
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Email task check-ins' })).getByRole('button', { name: 'Paste a reply…' }))
    expect(screen.queryByRole('dialog', { name: 'Email task check-ins' })).toBeNull()
    expect(dialog()).toBeTruthy()
  })
})
