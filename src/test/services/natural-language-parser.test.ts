import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { parseInput, removeSpans } from '../../services/natural-language-parser'

// Sat 10 Oct 2026, local time.
const TODAY = new Date(2026, 9, 10)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)
const parse = (text: string) => parseInput(text, TODAY)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 15, 30))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('parseInput — plain text', () => {
  it('a title with no tokens is untouched', () => {
    const r = parse('Buy groceries')
    expect(r.title).toBe('Buy groceries')
    expect(r.tokens).toHaveLength(0)
    expect(r.problems).toHaveLength(0)
    expect(r.dueDate).toBeUndefined()
    expect(r).toMatchObject({ urgent: false, important: false, focus: false, followupNone: false })
  })

  it('empty input', () => {
    const r = parse('')
    expect(r.title).toBe('')
    expect(r.tokens).toHaveLength(0)
  })

  // Free-text dates, deadlines, recurrence and `:status` are gone: they stay in the title.
  it.each([
    'Call mom tomorrow',
    'Submit report today',
    'Pay rent by fri',
    'Meeting friday',
    'Sprint planning next monday',
    'Lease due 5/4',
    'Renew !10/20',
    'Ship !tuesday',
    'Plan offsite next week',
    'Wrap up this month',
    'Followup in 3 days',
    'Pay rent 5/15/2099',
    'Standup every day',
    'Report every 2 weeks',
    'Backup repeat daily',
    'Fix login :blocked',
    ':doing fix it',
    'Send deck /Q4planning',
  ])('"%s" stays plain title text', (text) => {
    const r = parse(text)
    expect(r.title).toBe(text)
    expect(r.dueDate).toBeUndefined()
    expect(r.recurrence).toBeUndefined()
    expect(r.status).toBeUndefined()
    expect(r.tokens).toHaveLength(0)
  })

  it.each([
    'Review path/to/file',
    'Check the /etc/hosts file',
    'Read https://example.com/due/fri',
    'Split it a/b',
    'Half 1/2 done',
    'Stamp 2025/12/05',
    'Cut x/urgent here',
  ])('a / inside a word, path or URL is no command: "%s"', (text) => {
    const r = parse(text)
    expect(r.title).toBe(text)
    expect(r.tokens.filter((t) => t.type === 'command')).toHaveLength(0)
    expect(r.problems).toHaveLength(0)
  })
})

describe('parseInput — people', () => {
  it('extracts @person', () => {
    const r = parse('Review PR @Mike')
    expect(r.title).toBe('Review PR')
    expect(r.persons).toEqual(['Mike'])
  })

  it('extracts several and quoted names', () => {
    const r = parse('Review PR @Mike @"Sarah Connor"')
    expect(r.title).toBe('Review PR')
    expect(r.persons).toEqual(['Mike', 'Sarah Connor'])
  })

  it('a bare name is letters, accents, digits and _ in any script — the whole name, not a cut at the first accent', () => {
    const r = parse('Call @José, @Zoë2 and @Łukasz_K then @Ольга and @佐藤')
    expect(r.persons).toEqual(['José', 'Zoë2', 'Łukasz_K', 'Ольга', '佐藤'])
    expect(r.title).toBe('Call , and then and')
    // Decomposed (NFD) accents stay in the name too.
    expect(parse('ping @José').persons).toEqual(['José'])
  })

  it('a bare name stops at punctuation; quotes take any name', () => {
    expect(parse('ask @Mary-Jane').persons).toEqual(['Mary'])
    expect(parse('ask @"Mary-Jane"').persons).toEqual(['Mary-Jane'])
  })

  it('a person named like a date is just a person', () => {
    const r = parse('Ask @friday about the report')
    expect(r.persons).toEqual(['friday'])
    expect(r.dueDate).toBeUndefined()
  })

  it.each([
    'Email bob@acme.com about it',
    'a@b',
    'see foo@"Bar Baz"',
    'ping (@Dana)',
    'quote "@Dana"',
    'list x,@Dana',
  ])('`@` inside a word is plain text, like `#`: %s', (text) => {
    const r = parse(text)
    expect(r.persons).toEqual([])
    expect(r.tokens).toEqual([])
    expect(r.title).toBe(text)
  })

  it('a mention starts the text or follows whitespace; trailing punctuation stays text', () => {
    const r = parse('@Anna, mail bob@acme.com\t@Dana. then @"Sarah Connor"!')
    expect(r.persons).toEqual(['Anna', 'Dana', 'Sarah Connor'])
    expect(r.tokens.map((t) => [t.raw, t.start])).toEqual([['@Anna', 0], ['@Dana', 25], ['@"Sarah Connor"', 37]])
    expect(r.title).toBe(', mail bob@acme.com . then !')
  })
})

describe('parseInput — tags (#foo)', () => {
  type TagCase = { input: string; tags: string[]; title?: string }
  const cases: TagCase[] = [
    { input: '#foo bar', tags: ['foo'], title: 'bar' },
    { input: '/proj #foo bar', tags: ['foo'], title: '/proj bar' },
    { input: 'Do thing #Urgent', tags: ['Urgent'] },
    { input: '#Foo work #foo more #FOO', tags: ['Foo'] },
    { input: 'ship it #foo!', tags: ['foo'], title: 'ship it !' },
    { input: 'email@work#followup today', tags: [] },
    { input: '#alpha middle #beta end', tags: ['alpha', 'beta'], title: 'middle end' },
    { input: '#high-priority #v_2', tags: ['high-priority', 'v_2'] },
    // `#urgent` is a tag, `/urgent` the command.
    { input: 'fix #urgent', tags: ['urgent'], title: 'fix' },
  ]
  it.each(cases)('parses tags from "$input"', ({ input, tags, title }) => {
    const r = parse(input)
    expect(r.tags).toEqual(tags)
    if (title !== undefined) expect(r.title).toBe(title)
  })
})

describe('parseInput — flag commands', () => {
  it.each([
    ['/urgent', 'urgent'],
    ['/important', 'important'],
    ['/focus', 'focus'],
  ] as const)('%s sets %s and leaves the title', (cmd, flag) => {
    const r = parse(`Call legal ${cmd}`)
    expect(r[flag]).toBe(true)
    expect(r.title).toBe('Call legal')
    expect(r.tokens).toEqual([expect.objectContaining({ type: 'command', command: flag, value: '', raw: cmd })])
  })

  it('works at the start, any case, all together', () => {
    const r = parse('/URGENT /Important plan /focus')
    expect(r).toMatchObject({ urgent: true, important: true, focus: true, title: 'plan' })
  })

  it('a repeated flag is harmless', () => {
    const r = parse('a /urgent /urgent')
    expect(r.urgent).toBe(true)
    expect(r.title).toBe('a')
    expect(r.problems).toHaveLength(0)
  })

  it('a flag with trailing letters is an unknown command', () => {
    const r = parse('a /urgently')
    expect(r.urgent).toBe(false)
    expect(r.title).toBe('a /urgently')
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'unknown', raw: '/urgently' })])
  })
})

describe('parseInput — /due', () => {
  type DueCase = { arg: string; due: Date }
  const cases: DueCase[] = [
    { arg: 'today', due: day(2026, 10, 10) },
    { arg: 'tomorrow', due: day(2026, 10, 11) },
    { arg: 'tmr', due: day(2026, 10, 11) },
    { arg: 'mon', due: day(2026, 10, 12) },
    { arg: 'monday', due: day(2026, 10, 12) },
    { arg: 'fri', due: day(2026, 10, 16) },
    // Today is Saturday: `sat` is the next one, never today.
    { arg: 'sat', due: day(2026, 10, 17) },
    { arg: 'next fri', due: day(2026, 10, 16) },
    { arg: 'in 3 days', due: day(2026, 10, 13) },
    { arg: '3d', due: day(2026, 10, 13) },
    { arg: '1w', due: day(2026, 10, 17) },
    { arg: '2w', due: day(2026, 10, 24) },
    { arg: '1m', due: day(2026, 11, 10) },
    { arg: '10/30', due: day(2026, 10, 30) },
    // Past MM/DD rolls into next year.
    { arg: '5/4', due: day(2027, 5, 4) },
    { arg: '5/4/27', due: day(2027, 5, 4) },
    { arg: '12/31/2099', due: day(2099, 12, 31) },
    { arg: '24 Oct', due: day(2026, 10, 24) },
    { arg: 'Oct 24', due: day(2026, 10, 24) },
    { arg: '2026-10-24', due: day(2026, 10, 24) },
    { arg: 'Tue 13 Oct 2026', due: day(2026, 10, 13) },
    { arg: 'FRI', due: day(2026, 10, 16) },
  ]
  it.each(cases)('/due $arg', ({ arg, due }) => {
    const r = parse(`Renew domain /due ${arg}`)
    expect(r.dueDate).toEqual(due)
    expect(r.title).toBe('Renew domain')
    expect(r.problems).toHaveLength(0)
    expect(r.tokens.at(-1)).toMatchObject({ command: 'due', value: arg })
  })

  it('reads the longest date and leaves the rest in the title', () => {
    const r = parse('/due fri prep slides')
    expect(r.dueDate).toEqual(day(2026, 10, 16))
    expect(r.title).toBe('prep slides')
  })

  it('stops the argument at the next token', () => {
    const r = parse('/due 24 #q4 Oct')
    expect(r.dueDate).toBeUndefined()
    expect(r.tags).toEqual(['q4'])
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'unreadable', command: 'due', raw: '/due 24' })])
  })

  it.each(['frday', '13/1', '2/30', 'soon', 'this week', 'next month'])(
    'an unreadable argument stays in the title: /due %s',
    (arg) => {
      const r = parse(`Renew /due ${arg}`)
      expect(r.dueDate).toBeUndefined()
      expect(r.title).toBe(`Renew /due ${arg}`)
      const first = arg.split(' ')[0]
      expect(r.problems).toEqual([expect.objectContaining({ kind: 'unreadable', command: 'due', raw: `/due ${first}` })])
    },
  )

  it('a missing argument is unreadable', () => {
    const r = parse('Renew /due')
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'unreadable', raw: '/due' })])
    expect(r.title).toBe('Renew /due')
  })

  it('the first /due wins; a later one stays in the title', () => {
    const r = parse('/due mon review /due fri')
    expect(r.dueDate).toEqual(day(2026, 10, 12))
    expect(r.title).toBe('review /due fri')
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'duplicate', command: 'due', raw: '/due fri' })])
  })

  it('an unreadable first /due lets a later valid one count', () => {
    const r = parse('/due frday /due fri')
    expect(r.dueDate).toEqual(day(2026, 10, 16))
    expect(r.title).toBe('/due frday')
  })
})

describe('parseInput — /followup', () => {
  it.each([
    ['2w', day(2026, 10, 24)],
    ['1m', day(2026, 11, 10)],
    ['3m', day(2027, 1, 10)],
    ['10d', day(2026, 10, 20)],
    ['fri', day(2026, 10, 16)],
    ['24 Oct', day(2026, 10, 24)],
    ['10/30', day(2026, 10, 30)],
  ] as const)('/followup %s', (arg, date) => {
    const r = parse(`Vendor contract /followup ${arg}`)
    expect(r.nextFollowupAt).toEqual(date)
    expect(r.followupNone).toBe(false)
    expect(r.title).toBe('Vendor contract')
  })

  it('/follow-up is the same command', () => {
    expect(parse('x /follow-up 2w').nextFollowupAt).toEqual(day(2026, 10, 24))
  })

  it('/followup none drops the default', () => {
    const r = parse('x /followup none')
    expect(r.followupNone).toBe(true)
    expect(r.nextFollowupAt).toBeUndefined()
    expect(r.title).toBe('x')
  })

  it('an unreadable interval stays in the title', () => {
    const r = parse('x /followup 2x')
    expect(r.nextFollowupAt).toBeUndefined()
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'unreadable', command: 'followup', raw: '/followup 2x' })])
  })
})

describe('parseInput — /repeat', () => {
  it.each(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const)(
    '/repeat %s with a due date',
    (f) => {
      const r = parse(`Standup /due today /repeat ${f}`)
      expect(r.recurrence).toBe(f)
      expect(r.title).toBe('Standup')
      expect(r.problems).toHaveLength(0)
    },
  )

  it('without /due it is recognised but ignored (dropped from the title)', () => {
    const r = parse('Standup /repeat weekly')
    expect(r.title).toBe('Standup')
    expect(r.tokens.filter((t) => t.command === 'repeat')).toHaveLength(0)
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'ignored', command: 'repeat', raw: '/repeat weekly' })])
    // Kept so a due date picked in the editor can still anchor it.
    expect(r.recurrence).toBe('weekly')
  })

  it.each(['fortnightly', 'every', ''])('an unknown frequency stays in the title: "%s"', (arg) => {
    const r = parse(`x /due mon /repeat ${arg}`.trim())
    expect(r.recurrence).toBeUndefined()
    expect(r.problems.at(-1)).toMatchObject({ kind: 'unreadable', command: 'repeat' })
  })
})

describe('parseInput — /status', () => {
  it('a single word', () => {
    const r = parse('Fix login /status blocked')
    expect(r.status).toBe('blocked')
    expect(r.title).toBe('Fix login')
  })

  it('a quoted name with spaces', () => {
    const r = parse('Vendor /status "In progress" call')
    expect(r.status).toBe('In progress')
    expect(r.title).toBe('Vendor call')
  })

  it('an unclosed quote or missing name is unreadable', () => {
    expect(parse('x /status "In progress').problems[0]).toMatchObject({ kind: 'unreadable', raw: '/status "In' })
    expect(parse('x /status').problems[0]).toMatchObject({ kind: 'unreadable', raw: '/status' })
  })

  it('the first /status wins', () => {
    const r = parse('/status doing x /status blocked')
    expect(r.status).toBe('doing')
    expect(r.title).toBe('x /status blocked')
  })
})

describe('parseInput — unknown commands and mixes', () => {
  it('an unknown command stays in the title and is reported', () => {
    const r = parse('Call plumber /urgnt')
    expect(r.title).toBe('Call plumber /urgnt')
    expect(r.problems).toEqual([expect.objectContaining({ kind: 'unknown', raw: '/urgnt', start: 13, end: 19 })])
  })

  it('a board example: everything at once', () => {
    const r = parse('1:1 with Ben @Ben /due mon /repeat weekly /status waiting /followup none')
    expect(r).toMatchObject({
      title: '1:1 with Ben',
      persons: ['Ben'],
      dueDate: day(2026, 10, 12),
      recurrence: 'weekly',
      status: 'waiting',
      followupNone: true,
    })
    expect(r.tokens.map((t) => t.command ?? t.type)).toEqual(['person', 'due', 'repeat', 'status', 'followup'])
  })

  it('token spans index the text', () => {
    const text = 'Book venue #q4 /important /due 10/30'
    const r = parse(text)
    for (const t of r.tokens) expect(text.slice(t.start, t.end)).toBe(t.raw)
  })

  it('removeSpans removes spans and collapses whitespace', () => {
    expect(removeSpans('a  b c d', [{ start: 3, end: 4 }, { start: 7, end: 8 }])).toBe('a c')
  })
})
