import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  breakdownDrill, slippingDrill,
  tagRowDrill, trendBucketDrill, trendTotalDrill,
} from '../../../components/workspace/glance/glance-drills'

const today = new Date(2026, 9, 10) // Sat 10 Oct

describe('glance drills: every glance click’s task dialog, built in one place', () => {
  it('the sections’ dialogs', () => {
    expect(trendTotalDrill('created', 'the last 14 days', [4]).description).toBe('Tasks created in the last 14 days.')
    expect(trendBucketDrill(new Date(2026, 8, 27), 'week', today, { completed: [1], created: [2] }).title).toBe('Week of Sep 27')
    expect(breakdownDrill('Overdue tasks', 'tags', { key: 'none', label: 'No tag', ids: [1] }).description).toBe('Overdue tasks: the ones with no tag.')
  })

  it('a Number’s breakdown line by status or priority: its tasks, in its words', () => {
    expect(breakdownDrill('Open', 'status', { key: 'status-3', label: 'Waiting', ids: [4, 2] })).toEqual({
      title: 'Open · Waiting', glyph: 'status', description: 'Open: the ones with the status Waiting.', source: { kind: 'todos', todoIds: [4, 2] },
    })
    expect(breakdownDrill('Open', 'status', { key: 'none', label: 'No status', ids: [1] }).description).toBe('Open: the ones with no status.')
    expect(breakdownDrill('Open', 'priority', { key: 'priority-urgent', label: 'Urgent', ids: [5] })).toEqual({
      title: 'Open · Urgent', glyph: 'focus', description: 'Open: the ones with the priority Urgent.', source: { kind: 'todos', todoIds: [5] },
    })
    expect(breakdownDrill('Open', 'priority', { key: 'none', label: 'No priority', ids: [1] }).description).toBe('Open: the ones with no priority.')
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
  it('a tag’s open tasks (a Project pulse card); no tag', () => {
    expect(tagRowDrill({ id: 4, name: 'q4' }, [3, 1])).toEqual({
      title: '#q4', glyph: 'tag', description: 'Open tasks tagged #q4.', source: { kind: 'todos', todoIds: [3, 1] },
    })
    expect(tagRowDrill(null, [7])).toEqual({
      title: 'No tag', glyph: 'tag', description: 'Open tasks with no tag.', source: { kind: 'todos', todoIds: [7] },
    })
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
