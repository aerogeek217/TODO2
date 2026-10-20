import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { TopBar } from '../../../components/layout/TopBar'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { PersistedWorkspaceLayout } from '../../../models/workspace-layout'

/**
 * The layout tabs are only for a number of layouts a bar can show: past
 * that (e.g. a file with thousands of layouts) the top bar shows the
 * layout picker straight away and never mounts a tab per layout.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')

function openLayouts(n: number): void {
  const layouts: PersistedWorkspaceLayout[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1, name: `Layout ${i + 1}`, sortOrder: i, columns: [], createdAt: T0, modifiedAt: T0,
  }))
  const [first] = layouts
  useWorkspaceStore.setState({ layouts, activeLayoutId: 1, working: first ?? null, saved: first ?? null, hydrated: true, isDirty: false })
}

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TopBar />
    </MemoryRouter>,
  )
}

describe('TopBar — how many layout tabs', () => {
  beforeEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true))
  afterEach(cleanup)

  it('a few layouts show as tabs', () => {
    openLayouts(3)
    renderBar()
    expect(screen.getAllByTestId('layout-tab')).toHaveLength(3)
    expect(screen.queryByTestId('layout-picker')).toBeNull()
  })

  it('many layouts show the picker, with no tab per layout', () => {
    openLayouts(500)
    renderBar()
    expect(screen.queryAllByTestId('layout-tab')).toHaveLength(0)
    expect(screen.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Layout 1')
  })
})
