import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { knownTagCount, tagPickEntries, toggledId } from '../../../components/workspace/glance/menu-entries'
import { useNeglectMenuEntries } from '../../../components/workspace/neglect/neglect-menu'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import type { Tag } from '../../../models'
import type { NeglectTab } from '../../../models/workspace-layout'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'

const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }
const BETA: Tag = { id: 2, name: 'Project: Beta', color: '#e05050' }

const item = (entries: readonly MenuEntry[] | undefined, label: string) =>
  (entries ?? []).find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!

const neglectTab = (config: Partial<NeglectTab['config']>): NeglectTab =>
  ({ id: 'map', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [1] }, ...config } })

describe('the shared tag picks', () => {
  it('a checkbox per tag in the tags’ order; a tick adds at the end or takes out', () => {
    const onPick = vi.fn()
    const entries = tagPickEntries([ATLAS, BETA], [2], onPick)
    expect(entries.map((e) => (e as MenuItemEntry).label)).toEqual(['Project: Atlas', 'Project: Beta'])
    expect(item(entries, 'Project: Beta').checked).toBe(true)
    expect(item(entries, 'Project: Beta').keepOpen).toBe(true)
    item(entries, 'Project: Atlas').onSelect!()
    expect(onPick).toHaveBeenLastCalledWith([2, 1])
    item(entries, 'Project: Beta').onSelect!()
    expect(onPick).toHaveBeenLastCalledWith([])
    expect(tagPickEntries([], [], onPick)).toEqual([{ kind: 'note', text: 'No tags yet.' }])
    expect(item(tagPickEntries([ATLAS], [1], onPick, false), 'Project: Atlas').checked).toBe(false)
    expect(toggledId([3, 4], 3)).toEqual([4])
  })

  it('counts only the picked tags that still exist', () => {
    expect(knownTagCount([1, 2, 99], [ATLAS, BETA])).toBe(2)
    expect(knownTagCount([99], [ATLAS])).toBe(0)
  })
})

describe('the Neglect map’s tag-pick submenu', () => {
  it('a picked tag deleted since: the menu counts the tags that are left', () => {
    useTagStore.setState({ tags: [BETA] })
    const { result } = renderHook(() => useNeglectMenuEntries(neglectTab({ colourBy: { kind: 'tags', tagIds: [1, 2] } })))
    const colourBy = item(result.current, 'Color by')
    expect(colourBy.note).toBe('Tags (1)')
    expect(item(colourBy.children, 'Project: Beta').checked).toBe(true)
  })

  it('the Neglect map: its tag ticks colour by tags; it has no threshold of its own', () => {
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    useTagStore.setState({ tags: [ATLAS, BETA] })
    const { result } = renderHook(() => useNeglectMenuEntries(neglectTab({ colourBy: { kind: 'people' } })))
    const colourBy = item(result.current, 'Color by')
    expect(colourBy.note).toBe('People')
    // American spelling in every string of the menu (cr34 G11).
    const words = (entries: readonly MenuEntry[]): string[] => entries.flatMap((e) => (
      e.kind === 'item' ? [e.label, ...words(e.children ?? [])] : e.kind === 'label' || e.kind === 'note' ? [e.text] : []
    ))
    const all = words(result.current)
    expect(all).toContain('Color dots by')
    expect(all).toContain('A task with several picked tags takes the first one’s color.')
    expect(all.filter((w) => /colour/i.test(w))).toEqual([])
    expect(item(colourBy.children, 'Project: Atlas').checked).toBe(false)
    item(colourBy.children, 'Project: Beta').onSelect!()
    expect(patchTabConfig).toHaveBeenLastCalledWith('map', 'neglect', { colourBy: { kind: 'tags', tagIds: [2] } })
    // Untouched is Settings' Stale after: no menu item of its own.
    expect(item(result.current, 'Untouched after')).toBeUndefined()
  })
})
