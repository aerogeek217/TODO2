import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  breakdownDrill, eisenhowerPaneDrill, personRowDrill, slippingDrill,
  statusRowDrill, tagRowDrill, tagsDrill, trendBucketDrill, trendTotalDrill,
} from '../../../components/workspace/glance/glance-drills'
import { defaultPaneFilter, resolvePanes } from '../../../utils/eisenhower-panes'

const today = new Date(2026, 9, 10) // Sat 10 Oct

describe('glance drills: every glance click’s task dialog, built in one place', () => {
  it('the sections’ dialogs', () => {
    expect(trendTotalDrill('created', 'the last 14 days', [4]).description).toBe('Tasks created in the last 14 days.')
    expect(trendBucketDrill(new Date(2026, 8, 27), 'week', today, { completed: [1], created: [2] }).title).toBe('Week of Sep 27')
    expect(statusRowDrill({ id: null, label: 'No status' }, [1]).description).toBe('Open tasks with no status.')
    expect(statusRowDrill({ id: 4, label: 'Waiting' }, [1]).description).toBe('Status: Waiting.')
    expect(personRowDrill({ id: 7, name: 'Aisha' }, [1])).toMatchObject({ title: 'Aisha', personId: 7 })
    expect(personRowDrill(null, [1])).not.toHaveProperty('personId')
    expect(breakdownDrill('Overdue tasks', 'tags', { key: 'none', label: 'No tag', ids: [1] }).description).toBe('Overdue tasks: the ones with no tag.')
  })

  it('the statistics stay pure: no file under services/stats builds a dialog payload', () => {
    const dir = path.resolve(__dirname, '../../../services/stats')
    for (const name of fs.readdirSync(dir)) {
      const text = fs.readFileSync(path.join(dir, name), 'utf8')
      expect(text, name).not.toMatch(/task-dialog/)
    }
  })
})

describe('glance section payloads (moved from services/task-dialog)', () => {
  it('a tag row: that tag’s open tasks; the untagged row; the Tags count: a heading per tag', () => {
    expect(tagRowDrill({ id: 4, name: 'q4' }, [3, 1])).toEqual({
      title: '#q4', glyph: 'tag', description: 'Open tasks tagged #q4.', source: { kind: 'todos', todoIds: [3, 1] },
    })
    expect(tagRowDrill(null, [7])).toEqual({
      title: 'No tag', glyph: 'tag', description: 'Open tasks with no tag.', source: { kind: 'todos', todoIds: [7] },
    })
    expect(tagsDrill([
      { tag: { id: 4, name: 'q4', color: '#123' }, todoIds: [3, 1] },
      { tag: null, todoIds: [7] },
    ])).toEqual({
      title: 'Tagged tasks',
      glyph: 'tag',
      description: 'Open tasks by tag. A task with several tags shows under each.',
      source: {
        kind: 'groups',
        groups: [
          { key: 'tag-4', label: '#q4', color: '#123', todoIds: [3, 1] },
          { key: 'untagged', label: 'No tag', todoIds: [7] },
        ],
      },
    })
  })

  it('an Eisenhower quadrant, and every quadrant under headings, saying what Urgent includes', () => {
    const [doPane, schedule, , drop] = resolvePanes({})
    const all = (urgentRange: number | null) => ({ urgentRange, listName: null })
    expect(eisenhowerPaneDrill(schedule!, 'Important, not urgent', [4], all(3))).toEqual({
      title: 'Schedule',
      glyph: 'matrix',
      description: 'Open tasks that are important, not urgent. Urgent includes tasks due within 3 days.',
      source: { kind: 'todos', todoIds: [4] },
    })
    expect(eisenhowerPaneDrill(doPane!, '', [1], all(null)).description).toBe('Open tasks that are urgent and important.')
    expect(eisenhowerPaneDrill(drop!, '', [1], all(0)).description).toBe('Open tasks that are neither urgent nor important. Urgent includes tasks due today or earlier.')
  })

  it('custom panes and a list source: the pane names, the filter in words, the list named', () => {
    const panes = resolvePanes({ delegate: { name: 'Hand off', filter: { ...defaultPaneFilter('delegate'), statusIds: [3], negate: { statusIds: true } } } })
    const source = { urgentRange: 3, listName: 'Team' }
    const delegate = panes[2]!
    expect(eisenhowerPaneDrill(delegate, 'Urgent · not Important · not Waiting', [5], source)).toEqual({
      title: 'Hand off',
      glyph: 'matrix',
      description: 'Open tasks of “Team” in “Hand off” (Urgent · not Important · not Waiting) — the first pane each matches.',
      source: { kind: 'todos', todoIds: [5] },
    })
    expect(eisenhowerPaneDrill(panes[0]!, '', [1], source).description)
      .toBe('Open tasks of “Team” that are urgent and important. Urgent includes tasks due within 3 days.')
  })
})

describe('the task dialog service builds no glance payload', () => {
  it('every glance section payload lives in glance-drills, none in services/task-dialog', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../../../services/task-dialog.ts'), 'utf8')
    for (const word of ['Tagged tasks', 'Stale tasks', 'Recently completed', 'Slipping', 'urgent × important']) {
      expect(text, word).not.toContain(word)
    }
    expect(slippingDrill([2, 1], 14)).toEqual({
      title: 'Slipping',
      glyph: 'stale',
      description: 'Open tasks due soon or late and not changed in 14 days or more, latest first.',
      source: { kind: 'todos', todoIds: [2, 1] },
    })
  })
})
