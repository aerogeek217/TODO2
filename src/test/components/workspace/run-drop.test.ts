import { describe, it, expect, vi } from 'vitest'
import { DROP_FAILED_NOTICE, runDrop } from '../../../components/workspace/workspace-drag'
import { useUndoStore } from '../../../stores/undo-store'

describe('runDrop', () => {
  it('a drop whose writes fail says so in the snackbar instead of rejecting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(runDrop(async () => { throw new Error('quota') })).resolves.toBeUndefined()
    expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: DROP_FAILED_NOTICE })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('a drop that goes through says nothing', async () => {
    const drop = vi.fn(async () => {})
    await runDrop(drop)
    expect(drop).toHaveBeenCalledOnce()
    expect(useUndoStore.getState().snackbar).toBeNull()
  })
})
