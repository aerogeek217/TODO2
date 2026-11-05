import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UnsavedPrompt } from '../../../components/workspace/UnsavedPrompt'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { resetDb } from '../../helpers'

/**
 * A list save that fails keeps the prompt open — the draft is kept, and
 * leaving would drop it — and a second press while a save is in flight
 * saves nothing twice (cr31 W8).
 */

afterEach(cleanup)

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
  useListDraftStore.setState({ drafts: {} })
  await useListDefinitionStore.getState().load()
})

async function listWithDraft(name: string): Promise<number> {
  const id = await useListDefinitionStore.getState().add({ name, owner: { layoutId: 1 } })
  useListDraftStore.getState().edit(id, (d) => ({ ...d, name: `${name} edited` }))
  return id
}

describe('UnsavedPrompt and a failed list save (cr31 W8)', () => {
  it('one list: Save list that fails keeps the prompt (and the draft)', async () => {
    const id = await listWithDraft('Inbox')
    vi.spyOn(useListDefinitionStore.getState(), 'update').mockRejectedValue(new Error('disk full'))
    const onDone = vi.fn()
    render(<UnsavedPrompt lead="Leaving." layout={false} listIds={[id]} onDone={onDone} onCancel={vi.fn()} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save list' })) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save list' })).not.toBeDisabled())
    expect(onDone).not.toHaveBeenCalled()
    expect(id in useListDraftStore.getState().drafts).toBe(true)
  })

  it('several lists: a failed save keeps the prompt; a double click saves once', async () => {
    const a = await listWithDraft('A')
    const b = await listWithDraft('B')
    let release: () => void = () => {}
    const update = vi.spyOn(useListDefinitionStore.getState(), 'update').mockImplementation(
      () => new Promise<void>((_, reject) => { release = () => reject(new Error('disk full')) }),
    )
    const onDone = vi.fn()
    render(<UnsavedPrompt lead="Leaving." layout={false} listIds={[a, b]} onDone={onDone} onCancel={vi.fn()} />)
    const save = screen.getByRole('button', { name: /Save 2 checked/ })
    fireEvent.click(save)
    fireEvent.click(save)
    expect(save).toBeDisabled()
    await act(async () => { release() })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
    await act(async () => { release() })
    await waitFor(() => expect(screen.getByRole('button', { name: /Save 2 checked/ })).not.toBeDisabled())
    expect(update).toHaveBeenCalledTimes(2)
    expect(onDone).not.toHaveBeenCalled()
  })
})
