import { describe, it, expect, beforeEach } from 'vitest'
import { emptyPredicate, type Person, type Tag } from '../../models'
import {
  listReview,
  listReviewCount,
  openReview,
  peopleReview,
  personReview,
  queueOfSections,
  reviewListTab,
  tagReview,
  toggleReviewLens,
} from '../../services/review'
import { useListWidgetStore, type ShownList } from '../../stores/list-widget-store'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useReviewStore } from '../../stores/review-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { makeTodo } from '../helpers'

const section = (key: string, label: string, ids: number[]) => ({ key, label, todos: ids.map((id) => ({ id })) })

describe('queueOfSections', () => {
  it('a flat list: its tasks in order, no dividers', () => {
    expect(queueOfSections([section('all', 'All', [3, 1, 2])], false)).toEqual({ ids: [3, 1, 2], dividers: [] })
  })

  it('grouped: each group a divider before its first task; a task in two groups once, at its first place', () => {
    const sections = [section('p1', 'Aisha', [1, 2]), section('p2', 'Ben', [2, 3]), section('p3', 'Chen', [1])]
    expect(queueOfSections(sections, true)).toEqual({
      ids: [1, 2, 3],
      // Chen's only task is already under Aisha: no divider for an empty group.
      dividers: [{ index: 0, label: 'Aisha' }, { index: 2, label: 'Ben' }],
    })
  })
})

const shownList = (over: Partial<ShownList> = {}): ShownList => ({
  listId: 9,
  label: 'Aisha 1:1',
  description: 'list · People · Manual',
  grouped: true,
  sections: [section('waiting', 'Waiting', [4, 5]), section('doing', 'Doing', [6])],
  ...over,
})

describe('listReview', () => {
  it('reads the tab as shown (collapsed groups too: the shown sections hold them), with its name and words', () => {
    // A collapsed group is still in the widget's sections — collapse only hides its rows.
    useListWidgetStore.getState().setCollapsed('tab-1', ['waiting'])
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(listReview('tab-1')).toMatchObject({
      kind: 'list',
      title: 'Aisha 1:1',
      description: 'list · People · Manual',
      ids: [4, 5, 6],
      dividers: [{ index: 0, label: 'Waiting' }, { index: 2, label: 'Doing' }],
    })
    expect(listReviewCount('tab-1')).toBe(3)
  })

  it('an ungrouped list has no dividers', () => {
    useListWidgetStore.getState().setShown('tab-1', shownList({ grouped: false, sections: [section('all', 'All', [2, 1])] }))
    expect(listReview('tab-1')?.dividers).toEqual([])
  })

  it('a tab not on screen: nothing to review', () => {
    expect(listReview('tab-x')).toBeNull()
    expect(listReviewCount('tab-x')).toBe(0)
    expect(reviewListTab('tab-x')).toBe(false)
    expect(useReviewStore.getState().open).toBe(false)
  })

  it('setShown(null) removes the tab', () => {
    useListWidgetStore.getState().setShown('tab-1', shownList())
    useListWidgetStore.getState().setShown('tab-1', null)
    expect(useListWidgetStore.getState().shown).toEqual({})
  })
})

describe('openReview', () => {
  it('opens the deck on the payload and clears the selection', () => {
    useUIStore.getState().selectAll([4, 5])
    useListWidgetStore.getState().setShown('tab-1', shownList())
    expect(reviewListTab('tab-1')).toBe(true)
    expect(useReviewStore.getState()).toMatchObject({
      open: true,
      source: { kind: 'list', title: 'Aisha 1:1', description: 'list · People · Manual' },
      ids: [4, 5, 6],
      index: 0,
    })
    expect(useUIStore.getState().selectedTodoIds.size).toBe(0)
  })

  it('no tasks: nothing opens', () => {
    expect(openReview({ kind: 'tag', title: '#x', description: '', ids: [] })).toBe(false)
    expect(openReview(null)).toBe(false)
    expect(useReviewStore.getState().open).toBe(false)
  })
})

describe('person, people and tag reviews: the task dialog’s set and order', () => {
  const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
  const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
  const legal: Tag = { id: 7, name: 'legal', color: '#999' }

  beforeEach(() => {
    useTodoStore.setState({
      todos: [
        makeTodo({ id: 1, sortOrder: 3 }),
        makeTodo({ id: 2, sortOrder: 1 }),
        makeTodo({ id: 3, sortOrder: 2 }),
        makeTodo({ id: 4, sortOrder: 4, isCompleted: true }),
        makeTodo({ id: 5, sortOrder: 0 }),
      ],
    })
    usePersonStore.setState({
      people: [aisha, ben],
      assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha, ben]], [3, [ben]], [4, [aisha]]]),
    })
    useTagStore.setState({ tags: [legal], assignedTagsMap: new Map([[3, [legal]], [1, [legal]]]) })
  })

  it('a person: their open tasks, by sort order (a completed one left out)', () => {
    expect(personReview(aisha)).toMatchObject({ kind: 'person', title: 'Aisha', description: 'Open tasks assigned to Aisha.', ids: [2, 1] })
  })

  it('a tag: its open tasks, by sort order', () => {
    expect(tagReview(legal)).toMatchObject({ kind: 'tag', title: '#legal', description: 'Open tasks tagged #legal.', ids: [3, 1] })
  })

  it('several people: their open tasks together, each once', () => {
    expect(peopleReview([aisha, ben])).toMatchObject({
      kind: 'people',
      title: '2 people',
      description: 'Open tasks assigned to Aisha or Ben.',
      ids: [2, 3, 1],
    })
  })

  it('one person through peopleReview is that person’s review', () => {
    const viaPeople = peopleReview([ben])
    const viaPerson = personReview(ben)
    expect({ ...viaPeople, lens: undefined }).toEqual({ ...viaPerson, lens: undefined })
    expect(viaPeople.lens?.requery(true)).toEqual(viaPerson.lens?.requery(true))
  })
})

describe('the deck’s lens switch (item 10)', () => {
  const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
  const legal: Tag = { id: 7, name: 'legal', color: '#999' }
  const store = () => useReviewStore.getState()
  const current = () => store().order[store().index]

  beforeEach(() => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 1, sortOrder: 1 }), makeTodo({ id: 2, sortOrder: 2 }), makeTodo({ id: 3, sortOrder: 3 })],
    })
    usePersonStore.setState({ people: [aisha], assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha]], [3, [aisha]]]) })
    useTagStore.setState({ tags: [legal], assignedTagsMap: new Map([[2, [legal]]]) })
    useSettingsStore.setState({ lenses: [{ id: 'l1', name: 'Legal', predicate: { ...emptyPredicate(), tags: [7] } }], activeLensId: 'l1' })
  })

  it('a person’s review opens as before, without the lens; −N is what the lens would hide there', () => {
    expect(openReview(personReview(aisha))).toBe(true)
    expect(store().ids).toEqual([1, 2, 3])
    expect(store().lens).toMatchObject({ ignored: true, hides: 2, used: false })
  })

  it('a toggle takes the queue again under the lens, the current task kept while it stays; again, without it', () => {
    openReview(personReview(aisha))
    store().go(1)
    toggleReviewLens()
    expect(store()).toMatchObject({ ids: [2], order: [2], index: 0 })
    expect(store().lens).toMatchObject({ ignored: false, hides: 2, used: true })
    toggleReviewLens()
    expect(store()).toMatchObject({ ids: [1, 2, 3], order: [1, 2, 3] })
    expect(current()).toBe(2)
  })

  it('the current task left out by the lens: the next one that stays (the sort and marks kept)', () => {
    openReview(personReview(aisha))
    store().skip()
    expect(current()).toBe(2)
    store().back()
    toggleReviewLens()
    expect(current()).toBe(2)
    expect(store().marks).toEqual({ 1: 'skipped' })
  })

  it('no lens picked: hides nothing', () => {
    useSettingsStore.setState({ activeLensId: null })
    openReview(personReview(aisha))
    expect(store().lens).toMatchObject({ ignored: true, hides: 0 })
  })

  it('a list tab: under the lens unless the list ignores it; a toggle builds the list again without it', () => {
    useListDefinitionStore.setState({
      listDefinitions: [{
        id: 9, name: 'Aisha 1:1', sortOrder: 0, owner: { layoutId: 1 },
        membership: { kind: 'custom', predicate: emptyPredicate() }, sort: 'manual', grouping: 'none',
      }],
    })
    useListWidgetStore.getState().setShown('tab-1', shownList({ grouped: false, sections: [section('all', 'All', [2])] }))
    expect(reviewListTab('tab-1')).toBe(true)
    expect(store().lens).toMatchObject({ ignored: false, hides: 2 })
    toggleReviewLens()
    expect(store().ids).toEqual([1, 2, 3])
    expect(current()).toBe(2)
  })
})
