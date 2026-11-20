import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FileStorageSection } from '../../../components/settings/sections/FileStorageSection'
import { useFileStorageStore } from '../../../services/file-storage-store'

beforeEach(() => {
  useFileStorageStore.setState({
    isSupported: true, isConnected: false, fileName: null, needsPermission: false, paused: null, error: null, isLoading: false,
  })
})

afterEach(cleanup)

describe('Settings → File storage, no file attached', () => {
  it('says an existing file picked for Create New File is emptied before it can be backed up', () => {
    render(<FileStorageSection />)
    expect(screen.getByRole('button', { name: 'Create New File' })).toBeInTheDocument()
    expect(screen.getByText(/An existing file you replace is emptied by the browser before TODO2 can back it up\./)).toBeInTheDocument()
    expect(screen.queryByText(/could not check its sync file/)).toBeNull()
  })

  it('says sync is off when the sync file’s link wasn’t read at launch, and still offers to attach the file', () => {
    const openFile = vi.fn().mockResolvedValue(undefined)
    useFileStorageStore.setState({ linkUnread: true, openFile })
    render(<FileStorageSection />)
    expect(screen.getByText('TODO2 could not check its sync file when it started, so sync is off. Reload to try again, or attach the file again here.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Attach to File' }))
    expect(openFile).toHaveBeenCalledTimes(1)
  })
})

describe('Settings → File storage, permission needed', () => {
  it('offers Grant Access and Disconnect (which stops the question at every start)', () => {
    const disconnect = vi.fn().mockResolvedValue(undefined)
    useFileStorageStore.setState({ fileName: 'todo2.json', needsPermission: true, disconnect })
    render(<FileStorageSection />)
    expect(screen.getByText(/asks for it at every start until you grant it or disconnect the file/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Grant Access' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
