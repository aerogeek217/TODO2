import { describe, it, expect, beforeEach } from 'vitest'
import { emptyPredicate, type Person, type Tag } from '../../../models'
import { newBreakdownConfig } from '../../../models/chart-widgets'
import { breakdownRowLens } from '../../../components/workspace/glance/chart-drills'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { makeTodo } from '../../helpers'

/** A Breakdown row's review taken again with / without the top bar's lens (item 10). */
describe('breakdownRowLens', () => {
  const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
  const legal: Tag = { id: 7, name: 'legal', color: '#999' }

  beforeEach(() => {
    useTodoStore.setState({ todos: [makeTodo({ id: 1 }), makeTodo({ id: 2 }), makeTodo({ id: 3 })] })
    usePersonStore.setState({ people: [aisha], assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha]]]) })
    useTagStore.setState({ tags: [legal], assignedTagsMap: new Map([[2, [legal]]]) })
    useSettingsStore.setState({ lenses: [{ id: 'l1', name: 'Legal', predicate: { ...emptyPredicate(), tags: [7] } }], activeLensId: 'l1' })
  })

  it('the row’s tasks under the lens, or without it; a row gone has none', () => {
    const config = newBreakdownConfig(emptyPredicate(), { splitBy: 'people' })
    const lens = breakdownRowLens(config, false, 'person-1', 'all')
    expect(lens.ignored).toBe(false)
    expect([...lens.requery(true).ids].sort()).toEqual([1, 2])
    expect(lens.requery(false).ids).toEqual([2])
    expect(breakdownRowLens(config, true, 'person-9', 'all').requery(true).ids).toEqual([])
  })
})
