import { describe, expect, it } from 'vitest'
import {
  TASK_REF_LENGTH,
  TASK_REF_PATTERN,
  createTaskRefLookup,
  resolveTaskRef,
  taskRef,
  taskRefKey,
} from '../../../services/checkin-email/ref'

const uuid = '0C4D8E17-5b2a-4f1e-9c3d-7a6b5c4d3e2f'
const todo = (uid: string, id = 0) => ({ uid, id })

describe('taskRef', () => {
  it('is the first eight letters / digits of a UUID, lowercased', () => {
    expect(taskRef(uuid)).toBe('0c4d8e17')
    expect(taskRef('b71e05d9-0000-4000-8000-000000000000')).toBe('b71e05d9')
  })

  it('skips anything but ASCII letters and digits in an imported uid', () => {
    expect(taskRef('test-uid-12')).toBe('testuid1')
    expect(taskRef('  AB_cd.EF/gh:ij ')).toBe('abcdefgh')
  })

  it('falls back to a stable hash when the uid has fewer than eight letters / digits', () => {
    for (const uid of ['x', '', '---', 'αβγδεζηθικ', 'ab-12']) {
      const ref = taskRef(uid)
      expect(ref).toHaveLength(TASK_REF_LENGTH)
      expect(ref).toMatch(TASK_REF_PATTERN)
      expect(taskRef(uid)).toBe(ref)
    }
    expect(taskRef('x')).not.toBe(taskRef('y'))
    expect(taskRefKey('ab-12')).not.toBe('ab12')
  })

  it('is always lowercase letters and digits', () => {
    for (const uid of [uuid, 'Ünïcødé-uid-12345678', 'ABCDEFGHIJ']) expect(taskRef(uid)).toMatch(TASK_REF_PATTERN)
  })
})

describe('resolveTaskRef', () => {
  const a = todo(uuid, 1)
  const b = todo('0c4d9999-5b2a-4f1e-9c3d-7a6b5c4d3e2f', 2)
  const c = todo('test-uid-12', 3)
  const odd = todo('x', 4)

  it('finds the task whose uid the ref starts, after the same normalisation', () => {
    expect(resolveTaskRef('0c4d8e17', [a, b, c])).toEqual({ status: 'found', todo: a })
    expect(resolveTaskRef('0C4D-8E17', [a, b, c])).toEqual({ status: 'found', todo: a })
    expect(resolveTaskRef('0c4d8e175b2a', [a, b, c])).toEqual({ status: 'found', todo: a })
    expect(resolveTaskRef('testuid1', [a, b, c])).toEqual({ status: 'found', todo: c })
    expect(resolveTaskRef(taskRef('x'), [a, odd])).toEqual({ status: 'found', todo: odd })
  })

  it('not-found when nothing matches or the ref is shorter than eight characters', () => {
    expect(resolveTaskRef('ffffffff', [a, b])).toEqual({ status: 'not-found' })
    expect(resolveTaskRef('0c4d8e1', [a, b])).toEqual({ status: 'not-found' })
    expect(resolveTaskRef('', [a])).toEqual({ status: 'not-found' })
    expect(resolveTaskRef('0c4d8e17', [])).toEqual({ status: 'not-found' })
  })

  it('ambiguous when several tasks match', () => {
    const twin = todo('0c4d8e17-ffff-4fff-8fff-ffffffffffff', 5)
    const out = resolveTaskRef('0c4d8e17', [a, twin])
    expect(out.status).toBe('ambiguous')
    expect(out.status === 'ambiguous' && out.matches).toEqual([a, twin])
  })

  it('a key that is the whole ref wins over longer keys starting with it', () => {
    const short = todo('abcdefgh', 6)
    const long = todo('abcdefgh-12', 7)
    expect(resolveTaskRef('abcdefgh', [long, short])).toEqual({ status: 'found', todo: short })
  })
})

describe('createTaskRefLookup', () => {
  it('gives eight characters when no other uid shares them', () => {
    const refOf = createTaskRefLookup([uuid, 'b71e05d9-0000-4000-8000-000000000000'])
    expect(refOf(uuid)).toBe('0c4d8e17')
  })

  it('lengthens refs only as far as needed to tell colliding uids apart; each resolves', () => {
    const x = '0c4d8e17-aaaa-4000-8000-000000000000'
    const y = '0c4d8e17-aabb-4000-8000-000000000000'
    const z = 'b71e05d9-0000-4000-8000-000000000000'
    const refOf = createTaskRefLookup([x, y, z])
    expect(refOf(x)).toBe('0c4d8e17aaa')
    expect(refOf(y)).toBe('0c4d8e17aab')
    expect(refOf(z)).toBe('b71e05d9')
    const todos = [todo(x, 1), todo(y, 2), todo(z, 3)]
    for (const t of todos) expect(resolveTaskRef(refOf(t.uid), todos)).toEqual({ status: 'found', todo: t })
  })

  it('falls back to taskRef for a uid it was not given', () => {
    expect(createTaskRefLookup([])(uuid)).toBe('0c4d8e17')
  })
})
