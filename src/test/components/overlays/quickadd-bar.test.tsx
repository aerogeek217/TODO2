import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QuickAddBar, type QuickAddDraft } from '../../../components/overlays/QuickAddBar'
import { usePersonStore } from '../../../stores/person-store'
import { useOrgStore } from '../../../stores/org-store'
import { useProjectStore } from '../../../stores/project-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useSettingsStore } from '../../../stores/settings-store'
import type { PersistedPerson, PersistedStatus, Project } from '../../../models'

const anna: PersistedPerson = { id: 1, name: 'Anna', initials: 'AN' }
const bob: PersistedPerson = { id: 2, name: 'Bob', initials: 'BO' }
const triage: Project & { id: number } = {
  id: 10,
  name: 'Triage',
  canvasId: 1,
  positionX: 0,
  positionY: 0,
  isCollapsed: false,
  sortOrder: 0,
  createdAt: new Date(),
  color: '#0af',
}
const doingStatus: PersistedStatus = { id: 100, name: 'Doing', color: '#0af', sortOrder: 0 }

function seedStores() {
  usePersonStore.setState({
    people: [anna, bob],
    assignedPeopleMap: new Map(),
  })
  useOrgStore.setState({
    orgs: [],
    assignedOrgsMap: new Map(),
    personOrgMap: new Map(),
  })
  useProjectStore.setState({ projects: [triage] })
  useStatusStore.setState({ statuses: [doingStatus] })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map() })
  useSettingsStore.setState({ weekStartsOn: 1 })
}

function noop() {}

function getInput() {
  return screen.getByPlaceholderText('New task…') as HTMLInputElement
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

  it('renders chips for "@anna /triage #x tomorrow" parsed input', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('Fix the build @anna /triage #x tomorrow')

    // Person chip — anchored on the @-prefixed display label, not the
    // dropdown items (which match plain "Anna").
    expect(screen.getByText('@Anna')).toBeInTheDocument()
    // Project chip
    expect(screen.getByText('/Triage')).toBeInTheDocument()
    // Tag chip — slug as-typed, lowercase
    expect(screen.getByText('#x')).toBeInTheDocument()
    // Schedule chip — exact label depends on locale + today's date, so just
    // assert the calendar emoji rendered (no recurrence/deadline emojis here).
    const surface = screen.getByRole('dialog')
    expect(surface.textContent ?? '').toContain('📅')
  })

  it('Tab toggles the expanded panel; Tab again collapses it', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()

    fireEvent.keyDown(getInput(), { key: 'Tab' })
    // Expanded panel renders the Notes textarea label/placeholder.
    expect(screen.getByPlaceholderText('Notes (optional)…')).toBeInTheDocument()

    fireEvent.keyDown(getInput(), { key: 'Tab' })
    expect(screen.queryByPlaceholderText('Notes (optional)…')).not.toBeInTheDocument()
  })

  it('submit (Enter) calls onSubmit with parsed metadata then unmounts on close', () => {
    const submitted: QuickAddDraft[] = []
    const onSubmit = vi.fn((d: QuickAddDraft) => {
      submitted.push(d)
    })
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)

    // Trailing space detaches the cursor from the `/triage` token so the
    // autocomplete popup dismisses; otherwise the input's keydown handler
    // would intercept Enter for the popup.
    changeInput('Fix the build @anna /triage ')
    fireEvent.keyDown(getInput(), { key: 'Enter' })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    const draft = submitted[0]!
    expect(draft.title).toBe('Fix the build')
    expect(draft.rawTitle).toBe('Fix the build @anna /triage ')
    expect(draft.people.map((p) => p.id)).toEqual([1])
    expect(draft.project?.id).toBe(10)
    expect(draft.resolved.personIds).toEqual([1])
    expect(draft.resolved.projectId).toBe(10)
    expect(draft.notes).toBe('')
  })

  it('blank submit is a no-op (button disabled, Enter ignored)', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    render(<QuickAddBar open onClose={onClose} onSubmit={onSubmit} />)

    const createBtn = screen.getByRole('button', { name: /create/i })
    expect(createBtn).toBeDisabled()

    fireEvent.keyDown(getInput(), { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('"Open full editor →" calls onOpenFullEditor with the live draft', () => {
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

    // Trailing space dismisses the autocomplete popup so Tab toggles the
    // expanded panel instead of being consumed by the popup.
    changeInput('Need full fields @anna ')

    // The link only renders inside the expanded footer.
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    fireEvent.click(screen.getByText(/Open full editor/))

    expect(onOpenFullEditor).toHaveBeenCalledTimes(1)
    const draft = onOpenFullEditor.mock.calls[0]![0] as QuickAddDraft
    expect(draft.rawTitle).toBe('Need full fields @anna ')
    expect(draft.people.map((p) => p.id)).toEqual([1])
    // The bar deliberately does NOT close itself — the parent owns the
    // close-vs-handoff sequencing (App.tsx stashes the draft on ui-store
    // before flipping quickAddOpen=false).
    expect(onClose).not.toHaveBeenCalled()
  })

  it('seeds rawTitle + notes from initialDraft on the closed→open transition', () => {
    const { rerender } = render(
      <QuickAddBar
        open={false}
        onClose={noop}
        onSubmit={noop}
        initialDraft={{ rawTitle: 'Pre-seeded', notes: 'note body' }}
      />,
    )
    expect(screen.queryByPlaceholderText('New task…')).not.toBeInTheDocument()

    rerender(
      <QuickAddBar
        open
        onClose={noop}
        onSubmit={noop}
        initialDraft={{ rawTitle: 'Pre-seeded', notes: 'note body' }}
      />,
    )
    expect(getInput().value).toBe('Pre-seeded')

    // Notes seed only surfaces in the expanded panel.
    fireEvent.keyDown(getInput(), { key: 'Tab' })
    expect(
      (screen.getByPlaceholderText('Notes (optional)…') as HTMLTextAreaElement).value,
    ).toBe('note body')
  })

  it('input + notes textarea carry data-shortcut-scope="none"', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    expect(getInput()).toHaveAttribute('data-shortcut-scope', 'none')

    fireEvent.keyDown(getInput(), { key: 'Tab' })
    const textarea = screen.getByPlaceholderText('Notes (optional)…')
    expect(textarea).toHaveAttribute('data-shortcut-scope', 'none')
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

  it(':status prefix renders the status chip after parser extraction', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput(':doing fix it')

    // Status chip — the parser strips the `:doing` token and the resolver
    // matches it to status id 100.
    expect(screen.getByText('Doing')).toBeInTheDocument()
    // Title narrows to the un-tokenized words.
    const surface = screen.getByRole('dialog')
    expect(surface.textContent ?? '').not.toContain(':doing')
  })

  it('shows the unmatched hint when a name does not resolve', () => {
    render(<QuickAddBar open onClose={noop} onSubmit={noop} />)
    changeInput('check it @ghost /nope')
    expect(screen.getByText(/Unknown:/)).toBeInTheDocument()
    expect(screen.getByText('@ghost /nope')).toBeInTheDocument()
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
      orgs: [],
      tags: ['debug'],
      unmatchedPersons: [],
      unmatchedProjects: [],
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
