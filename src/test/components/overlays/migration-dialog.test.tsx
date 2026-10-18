import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import type { SaveTextFileResult } from '../../../services/save-file'

const save = vi.hoisted(() => ({ result: 'saved' as SaveTextFileResult, names: [] as string[] }))
vi.mock('../../../services/save-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/save-file')>()),
  saveTextFile: vi.fn(async (opts: { suggestedName: string }) => {
    save.names.push(opts.suggestedName)
    return save.result
  }),
}))

import { MigrationDialog } from '../../../components/overlays/MigrationDialog'

beforeEach(() => {
  save.names = []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function exportBackup(result: SaveTextFileResult) {
  save.result = result
  render(<MigrationDialog mode="legacy-import" info={{ sourceVersion: 12, descriptions: [] } as never} onProceed={() => {}} onCancel={() => {}} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Export backup' })) })
  // Built from the database, then handed to the save step.
  await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Exporting...' })).toBeNull())
}

describe('MigrationDialog — the backup export says what happened', () => {
  it('saved through the save dialog: "Exported!"', async () => {
    await exportBackup('saved')
    expect(screen.getByRole('button', { name: 'Exported!' })).toBeTruthy()
    expect(screen.queryByText(/Downloads folder/)).toBeNull()
  })

  it('a plain download: "Downloaded", naming the file and the Downloads folder', async () => {
    await exportBackup('downloaded')
    expect(screen.getByRole('button', { name: 'Downloaded' })).toBeTruthy()
    expect(save.names).toHaveLength(1)
    expect(screen.getByRole('status').textContent).toBe(`Downloaded ${save.names[0]} — check your Downloads folder.`)
  })

  it('cancelled: nothing changes', async () => {
    await exportBackup('cancelled')
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
