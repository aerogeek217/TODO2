import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  breakdownDrill, changeDrill, nextDayDrill, personRowDrill, statusRowDrill, trendBucketDrill, trendTotalDrill,
} from '../../../components/workspace/glance/glance-drills'
import type { Change } from '../../../services/stats/changes'

const today = new Date(2026, 9, 10) // Sat 10 Oct

describe('glance drills: every glance click’s task dialog, built in one place', () => {
  it('What changed: a sentence’s tasks, titled by what it says; none to open = no dialog', () => {
    const change = (c: Partial<Change> & Pick<Change, 'id'>): Change => ({ text: '', ids: [3, 1], ...c })
    expect(changeDrill(change({ id: 'late' }))).toMatchObject({ title: 'Went late since yesterday', glyph: 'overdue', source: { kind: 'todos', todoIds: [3, 1] } })
    expect(changeDrill(change({ id: 'followups' }))?.title).toBe('Follow-ups due')
    expect(changeDrill(change({ id: 'tag', subject: 'Project: Atlas' }))).toMatchObject({ title: 'Late in #Project: Atlas', description: 'Open tasks tagged #Project: Atlas that are late.' })
    expect(changeDrill(change({ id: 'status', subject: 'Waiting' }))?.description).toBe('Open tasks whose status has been Waiting for 21 days or more.')
    expect(changeDrill(change({ id: 'dueToday' }))?.title).toBe('Due today')
    expect(changeDrill(change({ id: 'closed', averageWeeks: 2 }))?.description).toContain('the average of the last 2 weeks')
    expect(changeDrill(change({ id: 'closed', averageWeeks: 1 }))?.description).toContain('the average of the last week')
    expect(changeDrill(change({ id: 'closed', averageWeeks: null }))?.description).toBe('Tasks completed this week, newest first.')
    expect(changeDrill(change({ id: 'closed', ids: [] }))).toBeNull()
  })

  it('the sections’ dialogs', () => {
    expect(nextDayDrill(null, 0, today, { due: [1], followup: [] }).title).toBe('Late')
    expect(nextDayDrill(today, 1, today, { due: [], followup: [2] })).toMatchObject({
      title: 'Today',
      source: { kind: 'groups', groups: [{ key: 'due', todoIds: [] }, { key: 'followup', todoIds: [2] }] },
    })
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
