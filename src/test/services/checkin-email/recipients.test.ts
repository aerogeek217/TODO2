import { describe, expect, it } from 'vitest'
import type { Person } from '../../../models'
import { checkinRecipients, openTaskCounts } from '../../../services/checkin-email/recipients'
import { makePerson, makeTodo } from '../../helpers'

const ada = makePerson({ id: 1, name: 'Ada' })
const bob = makePerson({ id: 2, name: 'Bob' })
const cy = makePerson({ id: 3, name: 'Cy' })
const dee = makePerson({ id: 4, name: 'Dee' })

const todos = [
  makeTodo({ id: 10 }),
  makeTodo({ id: 11 }),
  makeTodo({ id: 12, isCompleted: true }),
]
const assigned = new Map<number, Person[]>([[10, [bob]], [11, [ada, bob]], [12, [cy]]])

describe('checkinRecipients', () => {
  it('lists people with open tasks by name; completed tasks and unassigned people do not count', () => {
    expect(checkinRecipients([dee, cy, bob, ada], todos, assigned, []).map((p) => p.name)).toEqual(['Ada', 'Bob'])
  })

  it('puts the people it was opened for first, in that order, even without open tasks', () => {
    expect(checkinRecipients([ada, bob, cy, dee], todos, assigned, [dee, bob].map((p) => p.id)).map((p) => p.name))
      .toEqual(['Dee', 'Bob', 'Ada'])
  })

  it('skips ids of people that no longer exist', () => {
    expect(checkinRecipients([ada, bob], todos, assigned, [99]).map((p) => p.name)).toEqual(['Ada', 'Bob'])
  })
})

describe('openTaskCounts', () => {
  it('counts each person’s open tasks; completed tasks and people with none are left out', () => {
    expect(openTaskCounts(todos, assigned)).toEqual(new Map([[2, 2], [1, 1]]))
  })
})
