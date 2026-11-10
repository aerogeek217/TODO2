import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '../../../data/database'
import { layoutRepository } from '../../../data/layout-repository'
import { createTab } from '../../../models/workspace-layout'
import { UnsavedPrompt } from '../../../components/workspace/UnsavedPrompt'
import { settleLayoutWrites, useWorkspaceStore } from '../../../stores/workspace-store'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { resetDb } from '../../helpers'
import { single } from '../../helpers/layout-builders'

/**
 * A list made for a new tab: the tab is saved with the layout at once (its
 * list stays), so leaving asks only about the list's own unsaved edits —
 * never about the layout.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

async function setup(): Promise<{ layoutId: number; fresh: number }> {
  await resetDb()
  const layoutId = await layoutRepository.insert({
    name: 'A', createdAt: T0, modifiedAt: T0,
    ...single({ id: 'k', tabs: [createTab('notes', 'n')] }),
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

describe('UnsavedPrompt with a list made for a new tab', () => {
  it('asks about the list alone: the layout is saved already', async () => {
    const { fresh } = await setup()
    render(<UnsavedPrompt lead="You’re leaving." listIds={[fresh]} onDone={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Save changes to list “Fresh”?' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /Layout/ })).toBeNull()
  })

  it('Save list saves the list; Discard drops its edits and keeps the list (its tab is stored)', async () => {
    const { fresh } = await setup()
    const onDone = vi.fn()
    const { unmount } = render(<UnsavedPrompt lead="You’re leaving." listIds={[fresh]} onDone={onDone} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save list' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect((await db.listDefinitions.get(fresh))?.name).toBe('Fresh edited')
    unmount()

    const second = await setup()
    const done2 = vi.fn()
    render(<UnsavedPrompt lead="You’re leaving." listIds={[second.fresh]} onDone={done2} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(done2).toHaveBeenCalled())
    await settleLayoutWrites()
    expect((await db.listDefinitions.get(second.fresh))?.name).toBe('Fresh')
    expect(useListDraftStore.getState().drafts[second.fresh]).toBeUndefined()
  })
})
