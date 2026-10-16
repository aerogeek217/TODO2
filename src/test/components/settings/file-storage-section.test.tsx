import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileStorageSection } from '../../../components/settings/sections/FileStorageSection'
import { useFileStorageStore } from '../../../stores/file-storage-store'

beforeEach(() => {
  useFileStorageStore.setState({
    isSupported: true, isConnected: false, fileName: null, needsPermission: false, paused: null, error: null, isLoading: false,
  })
})

describe('Settings → File storage, no file attached', () => {
  it('says an existing file picked for Create New File is emptied before it can be backed up', () => {
    render(<FileStorageSection />)
    expect(screen.getByRole('button', { name: 'Create New File' })).toBeInTheDocument()
    expect(screen.getByText(/An existing file you replace is emptied by the browser before TODO2 can back it up\./)).toBeInTheDocument()
  })
})
