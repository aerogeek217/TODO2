import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '../../../data/database'
import { layoutRepository } from '../../../data/layout-repository'
import { createTab } from '../../../models/workspace-layout'
import { UnsavedPrompt } from '../../../components/workspace/UnsavedPrompt'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { resetDb } from '../../helpers'

/**
 * The combined Save / Discard prompt with a layout-only list made for the
 * unsaved layout edits: the list goes with them on Discard, so its row
 * follows the layout's row instead of offering a Save that would do nothing.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

async function setup(): Promise<{ layoutId: number; fresh: number }> {
  await resetDb()
  const layoutId = await layoutRepository.insert({
    name: 'A', createdAt: T0, modifiedAt: T0,
    columns: [{ id: 'c', weight: 1, cells: [{ id: 'k', weight: 1, tabs: [createTab('notes', 'n')] }] }],
  })
  await layoutRepository.setActiveId(layoutId)
  await useListDefinitionStore.getState().load()
  await ws().init()
  const fresh = await useListDefinitionStore.getState().add({ name: 'Fresh', owner: { layoutId } })
  ws().addWidget('lens', { kind: 'cell', cellId: 'k' }, { listDefinitionId: fresh })
  useListDraftStore.getState().edit(fresh, (d) => ({ ...d, name: 'Fresh edited' }))
  return { layoutId, fresh }
}

afterEach(cleanup)

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDraftStore.setState({ drafts: {} })
})

describe('UnsavedPrompt with a list made for the layout edits', () => {
  it('its row follows the layout row: unticking the layout unticks it, and it can’t be ticked alone', async () => {
    const { fresh } = await setup()
    render(<UnsavedPrompt lead="You’re leaving." layout listIds={[fresh]} onDone={vi.fn()} onCancel={vi.fn()} />)
    const layoutBox = screen.getByRole('checkbox', { name: /Layout “A”/ })
    const listBox = screen.getByRole('checkbox', { name: /List “Fresh”/ })
    expect(listBox).toBeDisabled()
    expect(listBox).toBeChecked()
    expect(screen.getByText('goes with the layout changes')).toBeInTheDocument()
    fireEvent.click(layoutBox)
    expect(listBox).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Save 0 checked/ })).toBeDisabled()
  })

  it('Save saves both; Discard all drops both (the list is deleted, nothing left unsaved)', async () => {
    const { fresh } = await setup()
    const onDone = vi.fn()
    const { unmount } = render(<UnsavedPrompt lead="You’re leaving." layout listIds={[fresh]} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Save 2 checked/ }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect((await db.listDefinitions.get(fresh))?.name).toBe('Fresh edited')
    expect(ws().isDirty).toBe(false)
    unmount()

    const second = await setup()
    const done2 = vi.fn()
    render(<UnsavedPrompt lead="You’re leaving." layout listIds={[second.fresh]} onDone={done2} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard all' }))
    await waitFor(() => expect(done2).toHaveBeenCalled())
    await waitFor(async () => expect(await db.listDefinitions.get(second.fresh)).toBeUndefined())
    expect(useListDraftStore.getState().drafts[second.fresh]).toBeUndefined()
  })
})
