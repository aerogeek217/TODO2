import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { PeopleEditor } from '../../../components/settings/PeopleEditor'
import { db } from '../../../data/database'
import { usePersonStore } from '../../../stores/person-store'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'

const realLoad = usePersonStore.getState().load

beforeEach(async () => {
  await db.delete()
  await db.open()
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map(), loading: false, error: null })
})

afterEach(() => {
  cleanup()
  usePersonStore.setState({ load: realLoad })
})

/** Renders the editor and waits for its mount-time `load()` (see TagEditor's test). */
async function renderEditor() {
  let mountLoad: Promise<void> | undefined
  usePersonStore.setState({ load: () => (mountLoad = realLoad()) })
  const utils = render(<PeopleEditor onClose={() => {}} />)
  await act(async () => { await mountLoad })
  return utils
}

function hexInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="text"][maxlength="7"]')
  if (!input) throw new Error('hex input not found')
  return input
}

describe('PeopleEditor', () => {
  it('adds a person without a color by default (neutral swatch)', async () => {
    const { getByPlaceholderText, getByText, findByText, container } = await renderEditor()
    fireEvent.click(getByText('+ Add Person'))
    fireEvent.change(getByPlaceholderText('Name'), { target: { value: 'Org: Acme' } })
    fireEvent.click(getByText('Add'))

    await findByText('Org: Acme')
    const [person] = usePersonStore.getState().people
    expect(person).toMatchObject({ name: 'Org: Acme', initials: 'OA' })
    expect('color' in person!).toBe(false)
    const swatch = container.querySelector<HTMLElement>('[class*="colorSwatch"]')
    expect(swatch?.style.background).toBe('rgb(156, 163, 175)') // NEUTRAL_PERSON_COLOR
    expect(NEUTRAL_PERSON_COLOR).toBe('#9CA3AF')
  })

  it('adds a person with a picked color', async () => {
    const { getByPlaceholderText, getByText, findByText, container } = await renderEditor()
    fireEvent.click(getByText('+ Add Person'))
    fireEvent.change(getByPlaceholderText('Name'), { target: { value: 'Ann Lee' } })
    fireEvent.change(hexInput(container), { target: { value: '#f28c4e' } })
    fireEvent.click(getByText('Add'))

    await findByText('Ann Lee')
    expect(usePersonStore.getState().people[0]).toMatchObject({ name: 'Ann Lee', color: '#f28c4e' })
    expect((await db.people.toArray())[0]).toMatchObject({ color: '#f28c4e' })
  })

  it('edits and then removes a person color', async () => {
    await usePersonStore.getState().add('Ann Lee', 'AL')
    const { getByText, findByText, getByLabelText, queryByLabelText, container } = await renderEditor()

    fireEvent.click(await findByText('Ann Lee'))
    expect(queryByLabelText('Remove color')).toBeNull()
    fireEvent.change(hexInput(container), { target: { value: '#123456' } })
    fireEvent.click(getByText('Save'))
    await waitFor(() => expect(usePersonStore.getState().people[0]?.color).toBe('#123456'))

    fireEvent.click(await findByText('Ann Lee'))
    fireEvent.click(getByLabelText('Remove color'))
    fireEvent.click(getByText('Save'))
    await waitFor(() => expect('color' in usePersonStore.getState().people[0]!).toBe(false))
    const stored = await db.people.toArray()
    expect('color' in stored[0]!).toBe(false)
  })

  it('has no org membership control', async () => {
    await usePersonStore.getState().add('Ann Lee', 'AL')
    const { findByText, queryByText } = await renderEditor()
    fireEvent.click(await findByText('Ann Lee'))
    expect(queryByText('Orgs')).toBeNull()
  })
})
