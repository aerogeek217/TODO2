import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuickAddBar, type QuickAddDraft } from '../../../components/overlays/QuickAddBar'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { PersistedPerson, PersistedStatus } from '../../../models'

const anna: PersistedPerson = { id: 1, name: 'Anna', initials: 'AN' }
const bob: PersistedPerson = { id: 2, name: 'Bob', initials: 'BO' }
const doingStatus: PersistedStatus = { id: 100, name: 'Doing', color: '#0af', sortOrder: 0 }

function seedStores() {
  usePersonStore.setState({
    people: [anna, bob],
    assignedPeopleMap: new Map(),
  })
  useStatusStore.setState({ statuses: [doingStatus] })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
}

function noop() {}

function getInput() {
  return screen.getByPlaceholderText('New task…') as HTMLInputElement
}

/** Texts of the chips row (what the task will get), without the chips' ×. */
function chipTexts() {
  const group = screen.queryByRole('group', { name: 'What the task gets' })
  return group
    ? Array.from(group.children, (el) => {
      const copy = el.cloneNode(true) as HTMLElement
      copy.querySelectorAll('button').forEach((b) => b.remove())
      return (copy.textContent ?? '').trim()
    })
    : []
}

function changeInput(value: string) {
  const input = getInput()
  fireEvent.change(input, { target: { value } })
  return input
}

describe('QuickAddBar', () => {
  beforeEach(() => {
    seedStores()
  })
  afterEach(() => {
    cleanup()
  })

  it('mounts when open=true and unmounts when open=false', () => {
    const { rerender } = render(
      <QuickAddBar open onClose={noop} onSubmit={noop} />,
    )
    expect(screen.getByPlaceholderText('New task…')).toBeInTheDocument()

    rerender(<QuickAddBar open={false} onClose={noop} onSubmit={noop} />)
    expect(screen.queryByPlaceholderText('New task…')).not.toBeInTheDocument()
  })

  it('Esc invokes onClose', () => {
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={noop} />)
    fireEvent.keyDown(getInput(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click on the backdrop closes the bar; a press inside the bar or a drag that ends on the backdrop does not', () => {
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={noop} />)
    const backdrop = screen.getByTestId('quickadd-backdrop')
    // A text drag from the input that is let go over the backdrop.
    fireEvent.mouseDown(getInput())
    fireEvent.click(backdrop)
    fireEvent.mouseDown(getInput())
    fireEvent.click(getInput())
    expect(onClose).not.toHaveBeenCalled()

    const press = fireEvent.mouseDown(backdrop)
    expect(press).toBe(false) // the focus stays in the input
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a press elsewhere on top of the page (outside the backdrop) still closes the bar', () => {
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={noop} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders chips for "@anna #x /due tomorrow /urgent" in task-row order', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Fix the build @anna #x /due tomorrow /urgent')

    const chips = chipTexts()
    // markers › tags › people › due › follow-up (the default)
    expect(chips[0]).toBe('Urgent')
    expect(chips[1]).toBe('#x')
    expect(chips[2]).toBe('AN@Anna')
    expect(chips[3]).toMatch(/^\w{3} \d+$/) // tomorrow: `Sun 11`
    expect(chips[4]).toMatch(/· default$/)
  })

  it('marker chips read Focus › Urgent › Important', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Fix the build /important /urgent /focus')
    expect(chipTexts().slice(0, 3)).toEqual(['Focus', 'Urgent', 'Important'])
  })

  it('a plain date word is title text: no due chip', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Call mom tomorrow ')
    expect(chipTexts()).toHaveLength(1) // only the default follow-up
    expect(chipTexts()[0]).toMatch(/default$/)
  })

  it('/followup replaces the default chip; none shows No follow-up', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Vendor /followup none ')
    expect(chipTexts()).toEqual(['No follow-up'])
    changeInput('Vendor /followup 2w ')
    expect(chipTexts()[0]).not.toMatch(/default/)
  })

  it('/repeat shows with a due date, and is reported as ignored without one', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Standup /due today /repeat daily ')
    expect(chipTexts()).toContain('Daily')
    changeInput('Standup /repeat weekly ')
    expect(chipTexts()).not.toContain('Weekly')
    expect(screen.getByText('Ignored:')).toBeInTheDocument()
    expect(screen.getByText('— repeating needs a /due date')).toBeInTheDocument()
  })

  it('lists problems: unknown command, unreadable date', () => {
    const onSubmit = vi.fn()
    render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
    changeInput('Call plumber /urgnt /due frday ')
    expect(screen.getByText('Unknown command:')).toBeInTheDocument()
    expect(screen.getByText("Can't read date:")).toBeInTheDocument()
    expect(screen.getByText('— try fri, tomorrow, 5/4, 10/30, 2w')).toBeInTheDocument()
    // Adding still works: both stay in the title.
    fireEvent.keyDown(getInput(), { key: 'Enter' })
    expect((onSubmit.mock.calls[0]![0] as QuickAddDraft).title).toBe('Call plumber /urgnt /due frday')
  })

  it('tints tokens in the mirror behind the input', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Call @anna /due fri /urgent /urgnt ')
    const tints = Array.from(screen.getByTestId('quickadd-mirror').querySelectorAll('[data-tint]'))
      .map((el) => `${el.textContent}:${el.getAttribute('data-tint')}`)
    expect(tints).toEqual(['@anna:chip', '/due fri:due', '/urgent:urgent'])
  })

  it('Tab calls onOpenFullEditor with the live draft', () => {
    const onOpenFullEditor = vi.fn()
    const onClose = vi.fn()
    render(
      <QuickAddBar
        open
        onClose={onClose}
        onSubmit={noop}
        onOpenFullEditor={onOpenFullEditor}
      />,
    )

    // Trailing space dismisses the autocomplete popup so Tab routes through
    // the bar's outer onKey handler instead of being consumed by the popup.
    changeInput('Need full fields @anna ')
    fireEvent.keyDown(getInput(), { key: 'Tab' })

    expect(onOpenFullEditor).toHaveBeenCalledTimes(1)
    const draft = onOpenFullEditor.mock.calls[0]![0] as QuickAddDraft
    expect(draft.rawTitle).toBe('Need full fields @anna ')
    expect(draft.people.map((p) => p.id)).toEqual([1])
    // Parent owns the close-vs-handoff sequencing — the bar deliberately
    // does NOT call onClose here.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('submit (Enter) calls onSubmit with parsed metadata then unmounts on close', () => {
    const submitted: QuickAddDraft[] = []
    const onSubmit = vi.fn((d: QuickAddDraft) => {
      submitted.push(d)
    })
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)

    // Trailing space detaches the cursor from the `@anna` token so the
    // autocomplete popup dismisses; otherwise the input's keydown handler
    // would intercept Enter for the popup.
    changeInput('Fix the build @anna ')
    fireEvent.keyDown(getInput(), { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    const draft = submitted[0]!
    expect(draft.title).toBe('Fix the build')
    expect(draft.rawTitle).toBe('Fix the build @anna ')
    expect(draft.people.map((p) => p.id)).toEqual([1])
    expect(draft.resolved.personIds).toEqual([1])
  })

  it('keeps an unknown `/word` in the title — no chip, no popup', () => {
    const onSubmit = vi.fn()
    render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
    // Cursor sits right after the `/` token (as with the `@` popup test), so
    // a `/` trigger would open the autocomplete here.
    const input = changeInput('Fix the build /')
    input.setSelectionRange(input.value.length, input.value.length)
    fireEvent.change(input, { target: { value: 'Fix the build /triage' } })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByText('Unknown command:')).toBeInTheDocument()

    fireEvent.keyDown(getInput(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
    expect(draft.title).toBe('Fix the build /triage')
    expect(draft.resolved.title).toBe('Fix the build /triage')
  })

  it('blank submit is a no-op (Enter on empty input does not fire onSubmit/onClose)', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)

    fireEvent.keyDown(getInput(), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Details button calls onOpenFullEditor with the live draft', () => {
    const onOpenFullEditor = vi.fn()
    const onClose = vi.fn()
    render(
      <QuickAddBar
        open
        onClose={onClose}
        onSubmit={noop}
        onOpenFullEditor={onOpenFullEditor}
      />,
    )

    changeInput('Need full fields @anna ')
    fireEvent.click(screen.getByRole('button', { name: /details/i }))

    expect(onOpenFullEditor).toHaveBeenCalledTimes(1)
    const draft = onOpenFullEditor.mock.calls[0]![0] as QuickAddDraft
    expect(draft.rawTitle).toBe('Need full fields @anna ')
    expect(draft.people.map((p) => p.id)).toEqual([1])
    // Parent owns close-vs-handoff sequencing — bar does not call onClose.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('seeds rawTitle from initialDraft on the closed→open transition', () => {
    const { rerender } = render(
      <QuickAddBar
        open={false}
        onClose={noop}
        onSubmit={noop}
        initialDraft={{ rawTitle: 'Pre-seeded' }}
      />,
    )
    expect(screen.queryByPlaceholderText('New task…')).not.toBeInTheDocument()

    rerender(
      <QuickAddBar
        open
        onClose={noop}
        onSubmit={noop}
        initialDraft={{ rawTitle: 'Pre-seeded' }}
      />,
    )
    expect(getInput().value).toBe('Pre-seeded')
  })

  it('input carries data-shortcut-scope="none"', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    expect(getInput()).toHaveAttribute('data-shortcut-scope', 'none')
  })

  it('global keyboard shortcuts are skipped when focus is inside the bar', () => {
    // The contract from use-keyboard-shortcuts.ts:34-44 is a pure DOM check
    // (`el.closest('[data-shortcut-scope="none"]')`). Replay that closure here
    // so the test fails if the attribute moves off the inputs.
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = getInput()
    expect(input.closest('[data-shortcut-scope="none"]')).toBe(input)
  })

  it('renders the autocomplete popup when "@" is typed and ranks people candidates', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = changeInput('@')
    // The hook keys off selectionStart; jsdom doesn't auto-update it on
    // fireEvent.change, so set it explicitly before the second change.
    input.setSelectionRange(1, 1)
    fireEvent.change(input, { target: { value: '@a' } })

    const popup = screen.getByRole('listbox')
    expect(popup).toBeInTheDocument()
    // Anna matches "a" prefix; Bob does not. Scope the assertion to the
    // popup body — the chip row above also renders an `@Anna` text node.
    const popupItems = popup.querySelectorAll('[role="option"]')
    const popupTexts = Array.from(popupItems, (el) => el.textContent ?? '')
    expect(popupTexts.some((t) => t.includes('@Anna'))).toBe(true)
    expect(popupTexts.some((t) => t.includes('@Bob'))).toBe(false)
  })

  it('/status renders the status chip; :status is plain text', () => {
    const onSubmit = vi.fn()
    render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
    changeInput('/status doing fix it :blocked')
    expect(chipTexts()).toContain('Doing')
    fireEvent.keyDown(getInput(), { key: 'Enter' })
    const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
    expect(draft.title).toBe('fix it :blocked')
    expect(draft.resolved.statusId).toBe(100)
  })

  it('shows the new-person hint when a name does not resolve', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('check it @ghost')
    expect(screen.getByText('New person:').parentElement).toHaveTextContent(/^New person:\s*@ghost\s*— created when you add the task$/)
    expect(chipTexts()).toContain('G@ghost')
    expect(screen.queryByText(/Unknown:/)).not.toBeInTheDocument()
  })

  it('names several new people, and keeps an unknown status on its own line', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('check it @ghost @"Marco Rossi" /status nope ')
    expect(screen.getByText('New people:')).toBeInTheDocument()
    expect(screen.getByText('@ghost @Marco Rossi')).toBeInTheDocument()
    expect(screen.getByText('Unknown status:').parentElement).toHaveTextContent(/^Unknown status:\s*\/status nope\s*— stays in the title$/)
  })

  describe('slash menu', () => {
    function typeAtCaret(value: string) {
      const input = getInput()
      input.setSelectionRange(0, 0)
      fireEvent.change(input, { target: { value } })
      input.setSelectionRange(value.length, value.length)
      fireEvent.change(input, { target: { value } })
      return input
    }
    const options = () => screen.getAllByRole('option').map((o) => o.textContent ?? '')

    it('/ lists the commands; typing filters', () => {
      render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
      typeAtCaret('Call legal /')
      expect(screen.getByRole('listbox', { name: 'Commands' })).toBeInTheDocument()
      expect(options().map((t) => t.split(/[A-Z]/)[0])).toEqual([
        '/focus', '/urgent', '/important', '/due', '/followup', '/repeat', '/status',
      ])
      typeAtCaret('Call legal /fo')
      expect(options()).toEqual(['/focusAdd to Focus', '/followupNext follow-up…'])
    })

    it('after ↓, ⏎ picks a command (no submit)', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Call legal /fo')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'ArrowDown' }) })
      expect(screen.getByRole('option', { name: /followup/ })).toHaveAttribute('aria-selected', 'true')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      expect(onSubmit).not.toHaveBeenCalled()
      expect(getInput().value).toBe('Call legal /followup ')
      // An argument command goes on to its argument.
      expect(screen.getByRole('listbox', { name: 'Next follow-up' })).toBeInTheDocument()
    })

    it('a date argument shows the live parse, or the error', () => {
      render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
      typeAtCaret('Renew /due tomorrow')
      expect(screen.getByRole('listbox', { name: 'Due date' })).toBeInTheDocument()
      expect(screen.getAllByRole('option')).toHaveLength(1)
      typeAtCaret('Renew /due frday')
      expect(screen.getByRole('alert')).toHaveTextContent('Can\'t read "frday"')
    })

    it('⏎ on an unreadable argument adds the task with the argument left in the title', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Renew /due frday')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      expect(onSubmit).toHaveBeenCalledTimes(1)
      const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
      expect(draft.title).toBe('Renew /due frday')
      expect(draft.resolved.dueDate).toBeUndefined()
    })

    it('⏎ while the popup is open adds the task, a half-typed token resolved to its best match', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Call legal /ur')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      expect(onSubmit).toHaveBeenCalledTimes(1)
      const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
      expect(draft.title).toBe('Call legal')
      expect(draft.rawTitle).toBe('Call legal /urgent ')
      expect(draft.resolved.urgent).toBe(true)
    })

    it('⏎ on a half-typed date argument adds the task with the suggested date', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Renew /due tom')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
      expect(draft.title).toBe('Renew')
      expect(draft.resolved.dueDate).toBeInstanceOf(Date)
    })

    it('⏎ on a date still being typed (no suggestion) adds the task with it left in the title', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Renew /due 24')
      expect(screen.getByRole('listbox', { name: 'Due date' })).toBeInTheDocument()
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      expect(onSubmit).toHaveBeenCalledTimes(1)
      expect((onSubmit.mock.calls[0]![0] as QuickAddDraft).title).toBe('Renew /due 24')
    })

    it('Tab picks the active row while the popup is open (no Details, no submit)', async () => {
      const onSubmit = vi.fn()
      const onOpenFullEditor = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} onOpenFullEditor={onOpenFullEditor} />)
      typeAtCaret('Call legal /ur')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Tab' }) })
      expect(getInput().value).toBe('Call legal /urgent ')
      expect(onSubmit).not.toHaveBeenCalled()
      expect(onOpenFullEditor).not.toHaveBeenCalled()
    })

    it('a title of tokens only: ⏎ adds nothing and says the task needs a title', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      changeInput('@anna /urgent ')
      expect(screen.queryByText('No title:')).not.toBeInTheDocument()
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('No title:')).toBeInTheDocument()
      // Typing again takes the line away.
      changeInput('Call @anna /urgent ')
      expect(screen.queryByText('No title:')).not.toBeInTheDocument()
    })

    it('Esc closes only the popup and leaves the text', async () => {
      const onClose = vi.fn()
      render(<QuickAddBar open onClose={onClose} onSubmit={noop} />)
      typeAtCaret('Call /ur')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Escape' }) })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      expect(getInput().value).toBe('Call /ur')
    })

    it('Tab hands the parsed commands to the editor draft', () => {
      const onOpenFullEditor = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={noop} onOpenFullEditor={onOpenFullEditor} />)
      changeInput('Call legal /urgent /focus /due fri /followup none ')
      fireEvent.keyDown(getInput(), { key: 'Tab' })
      const draft = onOpenFullEditor.mock.calls[0]![0] as QuickAddDraft
      expect(draft.rawTitle).toBe('Call legal /urgent /focus /due fri /followup none ')
      expect(draft.resolved).toMatchObject({ urgent: true, focus: true, followupNone: true, title: 'Call legal' })
      expect(draft.resolved.dueDate).toBeInstanceOf(Date)
    })
  })

  describe('@ create row', () => {
    function typeAtCaret(value: string) {
      const input = getInput()
      input.setSelectionRange(0, 0)
      fireEvent.change(input, { target: { value } })
      input.setSelectionRange(value.length, value.length)
      fireEvent.change(input, { target: { value } })
      return input
    }

    it('offers "Press ⏎ to create @Name" when nobody matches; Tab inserts the token', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Call legal @Marco')
      const listbox = screen.getByRole('listbox', { name: 'People' })
      const option = screen.getByRole('option', { name: 'Press ⏎ to create @Marco' })
      expect(listbox).toContainElement(option)
      expect(option).toHaveAttribute('aria-selected', 'true')

      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Tab' }) })
      expect(getInput().value).toBe('Call legal @Marco ')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onSubmit).not.toHaveBeenCalled()
      expect(screen.getByText('New person:')).toBeInTheDocument()
    })

    it('⏎ on the create row adds the task with the new person', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Call legal @Marco')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
      expect(draft.title).toBe('Call legal')
      expect(draft.resolved.unmatchedPersons).toEqual(['Marco'])
    })

    it('⏎ on a half-typed name adds the task with the best match', async () => {
      const onSubmit = vi.fn()
      render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
      typeAtCaret('Review @ann')
      await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
      const draft = onSubmit.mock.calls[0]![0] as QuickAddDraft
      expect(draft.title).toBe('Review')
      expect(draft.resolved.personIds).toEqual([1])
      expect(draft.resolved.unmatchedPersons).toEqual([])
    })

    it('a partial match lists matches only — no create row', () => {
      render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
      typeAtCaret('Review @ann')
      expect(screen.getByRole('option', { name: '@Anna' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /create/ })).not.toBeInTheDocument()
    })

    it('an exact initials match lists that person instead of offering create', () => {
      usePersonStore.setState({ people: [anna, bob, { id: 3, name: 'Alice Chen', initials: 'AC' }] })
      render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
      // "ac" is no substring of "alice chen", but the resolver matches the initials.
      typeAtCaret('Review @ac')
      expect(screen.getByRole('option', { name: '@Alice Chen' })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /create/ })).not.toBeInTheDocument()
    })

    it('no create row while a quoted name is being typed', () => {
      render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
      typeAtCaret('Call @"Marco')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })

  it('the footer names @ person, # tag and / command — no dates, no status prefix', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const text = screen.getByRole('dialog').textContent ?? ''
    expect(text).toContain('@ person')
    expect(text).toContain('# tag')
    expect(text).toContain('/ command')
    expect(text).toContain('Details Tab')
    expect(text).toContain('⏎ add')
    expect(text).toContain('Esc close')
    expect(text).not.toContain(': status')
    expect(text.toLowerCase()).not.toContain('tomorrow')
    expect(text.toLowerCase()).not.toContain('project')
  })
})

describe('QuickAddBar — parse override', () => {
  beforeEach(() => {
    seedStores()
  })
  afterEach(() => cleanup())

  it('uses the supplied parse function for chip rendering', () => {
    const parse = vi.fn((input: string) => ({
      title: input.replace(/\s*FIXED$/, ''),
      people: [anna],
      tags: ['debug'],
      unmatchedPersons: [],
      unmatchedStatuses: [],
    }))
    render(<QuickAddBar open onClose={noop} onSubmit={noop} parse={parse} />)
    changeInput('something FIXED')
    expect(parse).toHaveBeenCalled()
    expect(screen.getByText('@Anna')).toBeInTheDocument()
    expect(screen.getByText('#debug')).toBeInTheDocument()
  })
})

describe('QuickAddBar — render guarantees', () => {
  beforeEach(() => {
    seedStores()
  })
  afterEach(() => cleanup())

  it('does not render console errors or warnings on mount', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    act(() => {
      render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    })

    expect(errSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()

    errSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

describe('QuickAddBar — preset (e.g. an Eisenhower quadrant\'s "+")', () => {
  beforeEach(() => seedStores())
  afterEach(() => cleanup())

  it('shows the preset markers and the source before anything is typed', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} preset={{ urgent: true, important: true, source: 'Do' }} />)
    const texts = chipTexts()
    expect(texts.slice(0, 2)).toEqual(['Urgent', 'Important'])
    expect(texts.at(-1)).toBe('Adding to Do')
  })

  it('a typed /urgent adds to the preset (one chip each)', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} preset={{ important: true, source: 'Schedule' }} />)
    changeInput('Book caterer /urgent')
    expect(chipTexts().filter((t) => t === 'Urgent' || t === 'Important')).toEqual(['Urgent', 'Important'])
  })

  it('no preset: no chips row until something is typed', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    expect(chipTexts()).toEqual([])
  })

  it('a No preset marker (a list or pane that wants it off) shows no chip; alone it is no preset', () => {
    const { rerender } = render(<QuickAddBar open onClose={noop} onSubmit={noop} preset={{ urgent: false, important: true, source: 'Schedule' }} />)
    const texts = chipTexts()
    expect(texts[0]).toBe('Important')
    expect(texts).not.toContain('Urgent')
    expect(texts.at(-1)).toBe('Adding to Schedule')
    rerender(<QuickAddBar open onClose={noop} onSubmit={noop} preset={{ urgent: false }} />)
    expect(chipTexts()).toEqual([])
  })
})

describe('QuickAddBar — submit', () => {
  beforeEach(seedStores)
  afterEach(() => { cleanup() })

  it('a task that could not be stored keeps the bar open with the text as typed; the next Enter tries again', async () => {
    const onClose = vi.fn()
    const onSubmit = vi.fn<(d: QuickAddDraft) => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)
    changeInput('Call plumber @Anna /urgent ')
    await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(getInput()).toHaveValue('Call plumber @Anna /urgent ')

    await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a second Enter while the first submit runs does nothing', async () => {
    let finish!: (ok: boolean) => void
    const onSubmit = vi.fn(() => new Promise<boolean>((r) => { finish = r }))
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)
    changeInput('Once')
    fireEvent.keyDown(getInput(), { key: 'Enter' })
    fireEvent.keyDown(getInput(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => { finish(true) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a submit that rejects keeps the bar open, and the next Enter tries again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const onClose = vi.fn()
    const onSubmit = vi.fn<(d: QuickAddDraft) => Promise<boolean>>().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(true)
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)
    changeInput('Retry me')
    await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
    expect(onClose).not.toHaveBeenCalled()
    expect(getInput()).toHaveValue('Retry me')
    await act(async () => { fireEvent.keyDown(getInput(), { key: 'Enter' }) })
    expect(onSubmit).toHaveBeenCalledTimes(2)
    expect(onClose).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  it('a submit that finishes after the bar was closed and opened again does not close the new one', async () => {
    let finish!: (ok: boolean) => void
    const onSubmit = vi.fn(() => new Promise<boolean>((r) => { finish = r }))
    const onClose = vi.fn()
    const { rerender } = render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)
    changeInput('Slow')
    fireEvent.keyDown(getInput(), { key: 'Enter' })
    rerender(<QuickAddBar open={false} onClose={onClose} onSubmit={onSubmit} />)
    rerender(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)
    await act(async () => { finish(true) })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a plain (void) submit closes the bar at once', () => {
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={noop} />)
    changeInput('Plain')
    fireEvent.keyDown(getInput(), { key: 'Enter' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('QuickAddBar — chip ×', () => {
  beforeEach(seedStores)
  afterEach(() => { cleanup() })

  /** Types `text` with the caret at `caret` (the end by default). */
  function typeAt(text: string, caret = text.length) {
    const input = changeInput(text)
    input.focus()
    input.setSelectionRange(caret, caret)
    return input
  }

  /** Presses and clicks a chip's × as a mouse does; returns whether the press kept the focus. */
  function pressRemove(name: string): boolean {
    const button = screen.getByRole('button', { name })
    const kept = !fireEvent.mouseDown(button)
    fireEvent.click(button)
    return kept
  }

  it('every chip has a × that is not a Tab stop; the Adding to label has none', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} preset={{ focus: true, source: 'Focus' }} />)
    typeAt('Fix @Anna @Zed #x /due tomorrow /repeat daily /status Doing /urgent')
    const group = screen.getByRole('group', { name: 'What the task gets' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Remove Focus', 'Remove Urgent', 'Remove #x', 'Remove @Anna', 'Remove @Zed',
      'Remove due date', 'No follow-up', 'Remove repeat', 'Remove status',
    ])
    for (const b of buttons) expect(b.tabIndex).toBe(-1)
    expect(screen.getByText('Adding to Focus').querySelector('button')).toBeNull()
  })

  it('a tag chip: × cuts the tag from the text; the focus and the caret stay in the field', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Fix #work the build')
    expect(pressRemove('Remove #work')).toBe(true)
    expect(input).toHaveValue('Fix the build')
    expect(chipTexts()).not.toContain('#work')
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe('Fix the build'.length)
  })

  it('a caret before the cut stays put', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Fix #work the build', 2)
    pressRemove('Remove #work')
    expect(input.selectionStart).toBe(2)
  })

  it('person and new-person chips', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Call @Anna and @Zed')
    pressRemove('Remove @Anna')
    expect(input).toHaveValue('Call and @Zed')
    pressRemove('Remove @Zed')
    expect(input).toHaveValue('Call and')
    expect(screen.queryByText('New person:')).not.toBeInTheDocument()
  })

  it('a name typed twice shows one new-person chip, and its × cuts both', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Ask @Zed and @zed')
    expect(screen.getAllByRole('button', { name: /^Remove @Zed$/i })).toHaveLength(1)
    pressRemove('Remove @Zed')
    expect(input).toHaveValue('Ask and')
  })

  it('marker, due, repeat and status chips', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Standup /urgent /due today /repeat daily /status Doing')
    pressRemove('Remove Urgent')
    expect(input).toHaveValue('Standup /due today /repeat daily /status Doing')
    pressRemove('Remove repeat')
    expect(input).toHaveValue('Standup /due today /status Doing')
    pressRemove('Remove status')
    expect(input).toHaveValue('Standup /due today')
    pressRemove('Remove due date')
    expect(input).toHaveValue('Standup')
    expect(chipTexts()).toHaveLength(1) // the default follow-up
  })

  it('removing the due date leaves /repeat to the Ignored line', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Standup /due today /repeat daily')
    pressRemove('Remove due date')
    expect(input).toHaveValue('Standup /repeat daily')
    expect(screen.getByText('Ignored:')).toBeInTheDocument()
  })

  it('the follow-up: default → No follow-up → default', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Vendor call')
    expect(chipTexts()[0]).toMatch(/· default$/)
    pressRemove('No follow-up')
    expect(input).toHaveValue('Vendor call /followup none')
    expect(chipTexts()).toEqual(['No follow-up'])
    expect(input.selectionStart).toBe('Vendor call'.length)
    pressRemove('Use the default follow-up')
    expect(input).toHaveValue('Vendor call')
    expect(chipTexts()[0]).toMatch(/· default$/)
  })

  it('new tasks without a follow-up (Settings): no default chip; a typed one shows, its × removes it', () => {
    useSettingsStore.setState({ newTaskFollowup: false })
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Vendor call')
    expect(chipTexts()).toEqual([])
    changeInput('Vendor /followup 2w call')
    expect(chipTexts()).toHaveLength(1)
    pressRemove('Remove follow-up')
    expect(input).toHaveValue('Vendor call')
    expect(chipTexts()).toEqual([])
  })

  it('a set follow-up: × goes back to the default', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    const input = typeAt('Vendor /followup 2w call')
    pressRemove('Use the default follow-up')
    expect(input).toHaveValue('Vendor call')
    expect(chipTexts()[0]).toMatch(/· default$/)
  })

  it('Enter after a × adds the task without what was removed', () => {
    const onSubmit = vi.fn()
    render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} />)
    const input = typeAt('Fix the build #work @Anna')
    pressRemove('Remove #work')
    fireEvent.keyDown(input, { key: 'Enter' })
    const draft = onSubmit.mock.calls[0]?.[0] as QuickAddDraft
    expect(draft.title).toBe('Fix the build')
    expect(draft.resolved.tags).toEqual([])
    expect(draft.resolved.personIds).toEqual([anna.id])
    expect(draft.removedPresetMarkers).toBeUndefined()
  })

  it('a preset marker: × drops it from the preset, and the submit says so', () => {
    const onSubmit = vi.fn()
    render(<QuickAddBar open onClose={noop} onSubmit={onSubmit} preset={{ urgent: true, important: true, source: 'Do' }} />)
    pressRemove('Remove Urgent')
    expect(chipTexts()[0]).toBe('Important')
    expect(chipTexts()).not.toContain('Urgent')
    expect(chipTexts().at(-1)).toBe('Adding to Do')
    const input = typeAt('Book caterer')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect((onSubmit.mock.calls[0]?.[0] as QuickAddDraft).removedPresetMarkers).toEqual(['urgent'])
  })

  it('a marker both typed and preset: × removes both', () => {
    const onOpenFullEditor = vi.fn()
    render(<QuickAddBar open onClose={noop} onSubmit={noop} onOpenFullEditor={onOpenFullEditor} preset={{ important: true }} />)
    const input = typeAt('Book /important caterer')
    pressRemove('Remove Important')
    expect(input).toHaveValue('Book caterer')
    expect(chipTexts()).not.toContain('Important')
    fireEvent.keyDown(input, { key: 'Tab' })
    expect((onOpenFullEditor.mock.calls[0]?.[0] as QuickAddDraft).removedPresetMarkers).toEqual(['important'])
  })

  it('a removed preset marker comes back the next time the bar opens', () => {
    const preset = { urgent: true }
    const { rerender } = render(<QuickAddBar open onClose={noop} onSubmit={noop} preset={preset} />)
    pressRemove('Remove Urgent')
    expect(chipTexts()).toEqual([])
    rerender(<QuickAddBar open={false} onClose={noop} onSubmit={noop} preset={preset} />)
    rerender(<QuickAddBar open onClose={noop} onSubmit={noop} preset={preset} />)
    expect(chipTexts()[0]).toBe('Urgent')
  })

  it('a × does not close the bar', () => {
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={noop} />)
    typeAt('Fix #work')
    pressRemove('Remove #work')
    expect(onClose).not.toHaveBeenCalled()
  })
})
