import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { useShownListReport } from '../../../components/workspace/list/use-shown-list'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { emptyPredicate } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'

/**
 * A list tab's shown tasks with two widgets on the tab at once — its small
 * face and, in the face's popover, the full list: the latest report shows,
 * one going hands the tab back to the other, the last going removes it.
 */

const def: PersistedListDefinition = {
  id: 2, name: 'Aisha 1:1', sortOrder: 0, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: emptyPredicate() },
}
const section = (ids: number[]) => [{ key: 'all', label: 'All', todos: ids.map((id) => ({ id })) }]
const shownIds = () => useListWidgetStore.getState().shown.t1?.sections.flatMap((s) => s.todos.map((t) => t.id))

afterEach(cleanup)

describe('useShownListReport with two writers for one tab', () => {
  it('the popover going hands the tab back to the face', () => {
    const face = renderHook(({ ids }) => useShownListReport('t1', def, section(ids)), { initialProps: { ids: [1, 2] } })
    expect(shownIds()).toEqual([1, 2])
    const popover = renderHook(() => useShownListReport('t1', def, section([1, 2, 3])))
    expect(shownIds()).toEqual([1, 2, 3])
    popover.unmount()
    // The face's effect doesn't run again: its report comes back all the same.
    expect(shownIds()).toEqual([1, 2])
    face.unmount()
    expect(useListWidgetStore.getState().shown.t1).toBeUndefined()
  })

  it('the face going first leaves the popover’s report', () => {
    const face = renderHook(() => useShownListReport('t1', def, section([1])))
    const popover = renderHook(() => useShownListReport('t1', def, section([1, 2])))
    face.unmount()
    expect(shownIds()).toEqual([1, 2])
    popover.unmount()
    expect(useListWidgetStore.getState().shown.t1).toBeUndefined()
  })

  it('a writer’s new report is the latest', () => {
    const face = renderHook(({ ids }) => useShownListReport('t1', def, section(ids)), { initialProps: { ids: [1] } })
    renderHook(() => useShownListReport('t1', def, section([1, 2])))
    face.rerender({ ids: [4] })
    expect(shownIds()).toEqual([4])
  })
})
