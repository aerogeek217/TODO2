import { describe, it, expect } from 'vitest'
import {
  resolveCrossGroupMutation,
  UNGROUPED_GROUP_KEY,
} from '../../utils/cross-group-drag'

describe('resolveCrossGroupMutation', () => {
  describe('skip cases (returns null)', () => {
    it('returns null when source and target are the same group', () => {
      expect(resolveCrossGroupMutation('status', 'status-1', 'status-1', 10)).toBeNull()
      expect(resolveCrossGroupMutation('people', 'person-2', 'person-2', 10)).toBeNull()
      expect(resolveCrossGroupMutation('org', 'org-3', 'org-3', 10)).toBeNull()
      expect(resolveCrossGroupMutation('tag', 'tag-4', 'tag-4', 10)).toBeNull()
    })

    it('returns null when source key is missing', () => {
      expect(resolveCrossGroupMutation('status', null, 'status-1', 10)).toBeNull()
      expect(resolveCrossGroupMutation('people', undefined, 'person-2', 10)).toBeNull()
    })

    it('returns null when target key is missing', () => {
      expect(resolveCrossGroupMutation('status', 'status-1', null, 10)).toBeNull()
      expect(resolveCrossGroupMutation('people', 'person-1', undefined, 10)).toBeNull()
    })

    it('returns null for all date dimensions, even on cross-bucket drags', () => {
      expect(resolveCrossGroupMutation('date', 'today', 'later', 10)).toBeNull()
      expect(resolveCrossGroupMutation('scheduled', 'overdue', 'week', 10)).toBeNull()
      expect(resolveCrossGroupMutation('deadline', 'today', 'overdue', 10)).toBeNull()
    })

    it('returns null when target key has the wrong shape for status', () => {
      expect(resolveCrossGroupMutation('status', 'status-1', 'person-2', 10)).toBeNull()
      expect(resolveCrossGroupMutation('status', 'status-1', 'garbage', 10)).toBeNull()
    })

    it('returns null when both sides are unparseable under a many-to-many dimension', () => {
      expect(resolveCrossGroupMutation('people', 'garbage-a', 'garbage-b', 10)).toBeNull()
      expect(resolveCrossGroupMutation('tag', 'foo', 'bar', 10)).toBeNull()
    })
  })

  describe('status grouping', () => {
    it('sets statusId to the target group id', () => {
      expect(resolveCrossGroupMutation('status', 'status-1', 'status-2', 10)).toEqual({
        kind: 'status',
        todoId: 10,
        statusId: 2,
      })
    })

    it('drag from ungrouped → status sets statusId', () => {
      expect(resolveCrossGroupMutation('status', UNGROUPED_GROUP_KEY, 'status-2', 10)).toEqual({
        kind: 'status',
        todoId: 10,
        statusId: 2,
      })
    })

    it('drag from status → ungrouped clears statusId', () => {
      expect(resolveCrossGroupMutation('status', 'status-2', UNGROUPED_GROUP_KEY, 10)).toEqual({
        kind: 'status',
        todoId: 10,
        statusId: undefined,
      })
    })
  })

  describe('people grouping (replace semantics)', () => {
    it('cross-person drag removes source + adds target', () => {
      expect(resolveCrossGroupMutation('people', 'person-1', 'person-2', 10)).toEqual({
        kind: 'people',
        todoId: 10,
        removeId: 1,
        addId: 2,
      })
    })

    it('drag from "(no people)" → person is a pure add', () => {
      expect(resolveCrossGroupMutation('people', UNGROUPED_GROUP_KEY, 'person-2', 10)).toEqual({
        kind: 'people',
        todoId: 10,
        removeId: null,
        addId: 2,
      })
    })

    it('drag from person → "(no people)" is a pure remove', () => {
      expect(resolveCrossGroupMutation('people', 'person-1', UNGROUPED_GROUP_KEY, 10)).toEqual({
        kind: 'people',
        todoId: 10,
        removeId: 1,
        addId: null,
      })
    })
  })

  describe('org grouping (replace semantics)', () => {
    it('cross-org drag removes source + adds target', () => {
      expect(resolveCrossGroupMutation('org', 'org-1', 'org-2', 10)).toEqual({
        kind: 'org',
        todoId: 10,
        removeId: 1,
        addId: 2,
      })
    })

    it('drag from "(no org)" → org is a pure add', () => {
      expect(resolveCrossGroupMutation('org', UNGROUPED_GROUP_KEY, 'org-2', 10)).toEqual({
        kind: 'org',
        todoId: 10,
        removeId: null,
        addId: 2,
      })
    })

    it('drag from org → "(no org)" is a pure remove', () => {
      expect(resolveCrossGroupMutation('org', 'org-1', UNGROUPED_GROUP_KEY, 10)).toEqual({
        kind: 'org',
        todoId: 10,
        removeId: 1,
        addId: null,
      })
    })
  })

  describe('tag grouping (replace semantics)', () => {
    it('cross-tag drag removes source + adds target', () => {
      expect(resolveCrossGroupMutation('tag', 'tag-1', 'tag-2', 10)).toEqual({
        kind: 'tag',
        todoId: 10,
        removeId: 1,
        addId: 2,
      })
    })

    it('drag from "(no tag)" → tag is a pure add', () => {
      expect(resolveCrossGroupMutation('tag', UNGROUPED_GROUP_KEY, 'tag-2', 10)).toEqual({
        kind: 'tag',
        todoId: 10,
        removeId: null,
        addId: 2,
      })
    })

    it('drag from tag → "(no tag)" is a pure remove', () => {
      expect(resolveCrossGroupMutation('tag', 'tag-1', UNGROUPED_GROUP_KEY, 10)).toEqual({
        kind: 'tag',
        todoId: 10,
        removeId: 1,
        addId: null,
      })
    })
  })
})
