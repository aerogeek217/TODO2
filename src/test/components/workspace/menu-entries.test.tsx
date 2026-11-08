import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { glanceMenu } from '../../../components/workspace/glance/glance-menu'
import { knownTagCount, tagPickEntries, toggledId } from '../../../components/workspace/glance/menu-entries'
import { useNeglectMenuEntries } from '../../../components/workspace/neglect/neglect-menu'
import type { MenuEntry, MenuItemEntry } from '../../../components/shared/MenuPopover'
import type { Tag } from '../../../models'
import { createTab, type GlanceTab, type NeglectTab } from '../../../models/workspace-layout'
import { useTagStore } from '../../../stores/tag-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'

const ATLAS: Tag = { id: 1, name: 'Project: Atlas', color: '#4f8cff' }
const BETA: Tag = { id: 2, name: 'Project: Beta', color: '#e05050' }

const item = (entries: readonly MenuEntry[] | undefined, label: string) =>
  (entries ?? []).find((e): e is MenuItemEntry => e.kind === 'item' && e.label === label)!

const neglectTab = (config: Partial<NeglectTab['config']>): NeglectTab =>
  ({ id: 'map', kind: 'neglect', config: { colourBy: { kind: 'tags', tagIds: [1] }, untouchedDays: 14, ...config } })

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

describe('one tag-pick submenu for the glance widgets and the Neglect map', () => {
  it('a picked tag deleted since: both menus count the tags that are left', () => {
    useTagStore.setState({ tags: [BETA] })
    const pulse = createTab('pulse', 'p', { tagIds: [1, 2] }) as GlanceTab
    expect(item(glanceMenu(pulse, undefined)!.settingEntries, 'Tags').note).toBe('1')
    const { result } = renderHook(() => useNeglectMenuEntries(neglectTab({ colourBy: { kind: 'tags', tagIds: [1, 2] } })))
    const colourBy = item(result.current, 'Colour by')
    expect(colourBy.note).toBe('Tags (1)')
    expect(item(colourBy.children, 'Project: Beta').checked).toBe(true)
  })

  it('the Neglect map: its tag ticks colour by tags; Untouched after is a setting submenu', () => {
    const patchTabConfig = vi.fn()
    useWorkspaceStore.setState({ patchTabConfig })
    useTagStore.setState({ tags: [ATLAS, BETA] })
    const { result } = renderHook(() => useNeglectMenuEntries(neglectTab({ colourBy: { kind: 'people' } })))
    const colourBy = item(result.current, 'Colour by')
    expect(colourBy.note).toBe('People')
    expect(item(colourBy.children, 'Project: Atlas').checked).toBe(false)
    item(colourBy.children, 'Project: Beta').onSelect!()
    expect(patchTabConfig).toHaveBeenLastCalledWith('map', 'neglect', { colourBy: { kind: 'tags', tagIds: [2] } })
    const untouched = item(result.current, 'Untouched after')
    expect(untouched.note).toBe('14 days')
    expect(untouched.childrenWidth).toBe(200)
    item(untouched.children, '14 days').onSelect!()
    expect(patchTabConfig).toHaveBeenCalledTimes(1)
    item(untouched.children, '30 days').onSelect!()
    expect(patchTabConfig).toHaveBeenLastCalledWith('map', 'neglect', { untouchedDays: 30 })
  })
})
