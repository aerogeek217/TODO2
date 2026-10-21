import { describe, it, expect } from 'vitest'
import {
  applyAutocompletePick,
  bestMatchCompletion,
  carrySelection,
  implicitAccept,
  computeAutocomplete,
  isPartialDateArgument,
  isVisible,
  personItems,
  statusItems,
  tagItems,
  type AutocompleteItem,
  type AutocompleteRow,
  type AutocompleteSources,
  type AutocompleteView,
} from '../../services/nlp-autocomplete'
import { parseInput } from '../../services/natural-language-parser'
import { matchTag, resolveInput } from '../../services/nlp-resolver'
import { tokenTints } from '../../services/nlp-token-tints'

// Sat 10 Oct 2026.
const TODAY = new Date(2026, 9, 10)

const people: AutocompleteItem[] = [
  { id: 1, name: 'Anna', initials: 'AN', kind: 'person' },
  { id: 2, name: 'Dana Kim', initials: 'DK', kind: 'person' },
]
const tags: AutocompleteItem[] = [
  { id: 1, name: 'Backend', kind: 'tag' },
  { id: 2, name: 'q4', kind: 'tag' },
]
const statuses: AutocompleteItem[] = [
  { id: 1, name: 'To do', kind: 'status', icon: 'circle' },
  { id: 2, name: 'In progress', kind: 'status', icon: 'half' },
  { id: 3, name: 'Waiting', kind: 'status' },
  { id: 4, name: 'Blocked', kind: 'status' },
]

const sources: AutocompleteSources = {
  people, tags, statuses, commands: true, followupDefault: { count: 1, unit: 'm' }, today: TODAY,
}

/** The view with the cursor at the end of `text`. */
const at = (text: string, src: AutocompleteSources = sources) => computeAutocomplete(text, text.length, src)

function labels(view: AutocompleteView | null): string[] {
  return (view?.rows ?? []).map((r) => {
    switch (r.kind) {
      case 'entity': return r.item.name
      case 'create': return `create ${r.trigger}${r.name}`
      case 'command': return `/${r.command.name}`
      case 'value': return r.label
      case 'parsed': return `= ${r.label}`
      case 'error': return `! ${r.text}`
    }
  })
}

/** Pick `row` (default: the first) and return the new text. */
function pick(text: string, row?: (rows: AutocompleteRow[]) => AutocompleteRow | undefined) {
  const view = at(text)
  if (!view) throw new Error(`no popup for "${text}"`)
  const chosen = row ? row(view.rows) : view.rows[0]
  if (!chosen) throw new Error('no row')
  return applyAutocompletePick(text, view, chosen)
}

describe('trigger rule', () => {
  it.each(['a/b', 'path/to/', 'x 1/', 'https://x/', 'Check /etc/', 'a@b', 'x#y', 'mail bob@ac', 'ping (@Da', 'x,@Da'])(
    'no popup inside a word: "%s"',
    (text) => expect(isVisible(at(text))).toBe(false),
  )

  it('`/` opens at the start or after whitespace', () => {
    expect(at('/')?.mode).toBe('command')
    expect(at('Call legal /')?.mode).toBe('command')
  })

  it('`/` is no trigger when commands are off (the editor in edit mode)', () => {
    expect(at('Call /', { ...sources, commands: false })).toBeNull()
  })

  it('`:` is no trigger any more', () => {
    expect(at('fix :do')).toBeNull()
  })
})

describe('command list', () => {
  it('lists every command, in order, with the footer', () => {
    const view = at('Call legal /')
    expect(view?.header).toBe('Commands')
    expect(labels(view)).toEqual(['/focus', '/urgent', '/important', '/due', '/followup', '/repeat', '/status'])
    expect(view?.footer).toBe(true)
    expect(view?.anchor).toBe(11)
  })

  it('filters by prefix, any case, marking the typed part; no footer', () => {
    const view = at('Draft agenda #q4 /FO')
    expect(labels(view)).toEqual(['/focus', '/followup'])
    expect(view?.rows[0]).toMatchObject({ kind: 'command', matchLength: 2 })
    expect(view?.footer).toBe(false)
  })

  it('accepts the /follow-up spelling', () => {
    expect(labels(at('x /follow-'))).toEqual(['/followup'])
  })

  it('closes when nothing matches', () => {
    expect(at('x /xyz')).toBeNull()
  })

  it('a flag pick inserts the command and a space, and closes', () => {
    expect(pick('Call legal /ur')).toEqual({ value: 'Call legal /urgent ', cursor: 19, reopen: false })
  })

  it('an argument pick inserts the command and goes on to its argument', () => {
    const p = pick('Renew domain /d')
    expect(p).toEqual({ value: 'Renew domain /due ', cursor: 18, reopen: true })
    const next = computeAutocomplete(p!.value, p!.cursor, sources)
    expect(next?.mode).toBe('argument')
    expect(next?.header).toBe('Due date')
  })

  it('keeps the text after the cursor', () => {
    const view = computeAutocomplete('a /fo b', 5, sources)!
    expect(applyAutocompletePick('a /fo b', view, view.rows[0]!)?.value).toBe('a /focus b')
  })
})

describe('/due argument', () => {
  it('suggests the grammar when empty', () => {
    const view = at('Renew domain /due ')
    expect(view).toMatchObject({ mode: 'argument', command: 'due', header: 'Due date', anchor: 13 })
    expect(view?.hint).toBe('fri, tomorrow, 5/4, 10/30, 2w')
    expect(view?.rows.map((r) => r.kind === 'value' && `${r.label} ${r.detail}`)).toEqual([
      'today Sat 10', 'tomorrow Sun 11', 'mon Mon 12', 'fri Fri 16', '1w Sat 17',
    ])
  })

  it('shows the live parse of a valid argument', () => {
    const view = at('Renew domain /due fri')
    expect(view?.rows).toEqual([expect.objectContaining({ kind: 'parsed', insert: 'fri', label: 'Fri 16 Oct', relative: 'in 6 days' })])
  })

  it('reads multi-word dates', () => {
    expect(labels(at('x /due in 3 days'))).toEqual(['= Tue 13 Oct'])
    expect(labels(at('x /due next mon'))).toEqual(['= Mon 12 Oct'])
    expect(labels(at('x /due 24 oct'))).toEqual(['= Sat 24 Oct'])
  })

  it('filters the suggestions while a word is half typed', () => {
    expect(labels(at('x /due to'))).toEqual(['today', 'tomorrow'])
  })

  it('waits with the hint while a longer date is in progress', () => {
    for (const text of ['x /due next ', 'x /due in 3', 'x /due 24', 'x /due wed', 'x /due 5/4/2']) {
      const view = at(text)
      expect(isVisible(view), text).toBe(true)
      expect(view?.rows.some((r) => r.kind === 'error'), text).toBe(false)
    }
  })

  it("can't read an unreadable argument", () => {
    const view = at('Renew domain /due frday')
    expect(view?.rows).toEqual([{ kind: 'error', text: 'Can\'t read "frday"', hint: 'Try fri, tomorrow, 5/4, 10/30, 2w' }])
    expect(applyAutocompletePick('Renew domain /due frday', view!, view!.rows[0]!)).toBeNull()
  })

  it('a space after a valid argument closes it', () => {
    expect(at('Renew /due fri ')).toBeNull()
    expect(at('Renew /due fri then')).toBeNull()
  })

  it('a pick inserts the argument and a space', () => {
    expect(pick('Renew /due ', (rows) => rows[3])?.value).toBe('Renew /due fri ')
    expect(pick('Renew /due fri')).toEqual({ value: 'Renew /due fri ', cursor: 15, reopen: false })
  })

  it('another token ends the argument', () => {
    expect(at('x /due fri @')?.mode).toBe('entity')
  })
})

describe('/followup argument', () => {
  it('suggests the quick intervals, marks the default, offers none', () => {
    const view = at('Vendor contract /followup ')
    expect(view?.header).toBe('Next follow-up')
    expect(view?.rows).toEqual([
      expect.objectContaining({ label: '1w', detail: 'Sat 17 Oct' }),
      expect.objectContaining({ label: '2w', detail: 'Sat 24 Oct' }),
      expect.objectContaining({ label: '1m', detail: 'Tue 10 Nov', note: 'default' }),
      expect.objectContaining({ label: '3m', detail: 'Sun 10 Jan 2027' }),
      expect.objectContaining({ label: 'none', detail: 'No follow-up', separator: true }),
    ])
  })

  it('while new tasks get no follow-up, none is the default', () => {
    const rows = at('Vendor contract /followup ', { ...sources, followupDefault: null })?.rows ?? []
    expect(rows.filter((r) => 'note' in r && r.note === 'default').map((r) => 'label' in r && r.label)).toEqual(['none'])
  })

  it('reads an interval and none', () => {
    expect(labels(at('x /followup 2w'))).toEqual(['= Sat 24 Oct'])
    expect(labels(at('x /followup no'))).toEqual(['none'])
    expect(labels(at('x /followup none'))).toEqual(['none'])
  })
})

describe('/status argument', () => {
  it('lists every status in Settings order', () => {
    const view = at('Vendor contract /status ')
    expect(view?.header).toBe('Status')
    expect(labels(view)).toEqual(['To do', 'In progress', 'Waiting', 'Blocked'])
  })

  it('filters by prefix; a multi-word name is inserted quoted', () => {
    expect(labels(at('x /status in'))).toEqual(['In progress'])
    expect(pick('x /status in')?.value).toBe('x /status "In progress" ')
    expect(pick('x /status w')?.value).toBe('x /status Waiting ')
  })

  it('follows a quoted name across its space', () => {
    expect(labels(at('x /status "In pro'))).toEqual(['In progress'])
    expect(at('x /status "In progress" ')).toBeNull()
  })

  it('closes when no status matches', () => {
    expect(at('x /status zz')).toBeNull()
  })
})

describe('/repeat argument', () => {
  it('lists the frequencies; anchors on the due date when there is one', () => {
    const view = at('1:1 with Ben /due mon /repeat ')
    expect(view?.header).toBe('Repeat')
    expect(view?.headerNote).toBe('from Mon 12')
    expect(view?.rows.map((r) => r.kind === 'value' && [r.label, r.detail ?? ''])).toEqual([
      ['daily', ''], ['weekly', 'every Mon'], ['biweekly', 'every 2 weeks'],
      ['monthly', ''], ['quarterly', ''], ['yearly', ''],
    ])
  })

  it('without a due date there is no anchor note', () => {
    expect(at('x /repeat ')?.headerNote).toBeUndefined()
  })

  it('filters by prefix', () => {
    expect(labels(at('x /repeat w'))).toEqual(['weekly'])
  })
})

describe('@ and #', () => {
  it('@ matches people by substring or exact initials; # tags by prefix', () => {
    expect(labels(at('x @an'))).toEqual(['Anna', 'Dana Kim', 'create @an'])
    expect(labels(at('x @dk'))).toEqual(['Dana Kim', 'create @dk'])
    expect(labels(at('x #b'))).toEqual(['Backend', 'create #b'])
  })

  it('a Create row below the matches unless one is exactly the name typed (any case)', () => {
    expect(labels(at('x @anna'))).toEqual(['Anna'])
    expect(labels(at('x @ANNA'))).toEqual(['Anna'])
    expect(labels(at('x @ann'))).toEqual(['Anna', 'create @ann'])
    expect(labels(at('x #backend'))).toEqual(['Backend'])
    expect(labels(at('x #back'))).toEqual(['Backend', 'create #back'])
    // The best match is highlighted on open; with no match, the Create row is the only row.
    expect(at('x @ann')?.rows[0]?.kind).toBe('entity')
  })

  it('offers create when nothing matches (not while a quote is open)', () => {
    expect(labels(at('x @Marco'))).toEqual(['create @Marco'])
    expect(labels(at('x #new'))).toEqual(['create #new'])
    expect(isVisible(at('x @"Marco'))).toBe(false)
  })

  it('offers create only for a name the parser reads whole', () => {
    // `##` (a Markdown heading being typed) and `#a.b` would not round-trip.
    expect(isVisible(at('##'))).toBe(false)
    expect(isVisible(at('x #a.b'))).toBe(false)
    expect(isVisible(at('x @bob.smith'))).toBe(false)
    expect(labels(at('x #q4-plan'))).toEqual(['create #q4-plan'])
    expect(labels(at('x @Marco_R'))).toEqual(['create @Marco_R'])
  })

  it('offers create for a name with accents or in another script (the parser reads it whole)', () => {
    expect(labels(at('x @José'))).toEqual(['create @José'])
    expect(labels(at('x @Ольга'))).toEqual(['create @Ольга'])
    expect(pick('x @José')?.value).toBe('x @José ')
    // Tags stay ASCII: no create row for one the parser would cut.
    expect(isVisible(at('x #café'))).toBe(false)
  })

  it('a picked name that isn’t bare is quoted, so it reads back whole', () => {
    const src = { ...sources, people: [{ id: 9, name: 'Mary-Jane', kind: 'person' as const }] }
    const view = at('x @mary', src)!
    expect(applyAutocompletePick('x @mary', view, view.rows[0]!)?.value).toBe('x @"Mary-Jane" ')
  })

  it('picks quote a name with a space', () => {
    expect(pick('Call @dan')?.value).toBe('Call @"Dana Kim" ')
    expect(pick('Call @Marco')?.value).toBe('Call @Marco ')
  })

  it('people: an exact name or initials match comes first, then names starting with the query', () => {
    const src = { ...sources, people: [
      { id: 1, name: 'Sal', initials: 'SA', kind: 'person' as const },
      { id: 2, name: 'Alice', initials: 'AC', kind: 'person' as const },
      { id: 3, name: 'Al', initials: 'AX', kind: 'person' as const },
    ] }
    expect(labels(at('x @al', src))).toEqual(['Al', 'Alice', 'Sal'])
    expect(labels(at('x @ali', src))).toEqual(['Alice', 'create @ali'])
    expect(labels(at('x @a', src))).toEqual(['Alice', 'Al', 'Sal', 'create @a'])
    // An exact name beats someone's initials (a person just made from the Create row).
    const withAc = { ...sources, people: [...src.people, { id: 4, name: 'AC', initials: 'A2', kind: 'person' as const }] }
    expect(labels(at('x @ac', withAc))).toEqual(['AC', 'Alice'])
  })
})

describe('bestMatchCompletion', () => {
  /** `text` with its token completed for a submit, the cursor at the end. */
  const complete = (text: string) => {
    const view = at(text)
    if (!view) throw new Error(`no popup for "${text}"`)
    return bestMatchCompletion(text, view)
  }

  it('completes a half-typed person, tag, flag command or argument to the first row', () => {
    expect(complete('Call @ann')).toBe('Call @Anna ')
    expect(complete('Call @dan')).toBe('Call @"Dana Kim" ')
    expect(complete('Plan #ba')).toBe('Plan #Backend ')
    expect(complete('Fix /ur')).toBe('Fix /urgent ')
    expect(complete('Renew /due tom')).toBe('Renew /due tomorrow ')
    expect(complete('Ping /followup 2')).toBe('Ping /followup 2w ')
    expect(complete('Ship /status in')).toBe('Ship /status "In progress" ')
    expect(complete('Pay /repeat mon')).toBe('Pay /repeat monthly ')
  })

  it('leaves the text as typed when there is nothing to complete', () => {
    // A new name (created with the task), an already readable date.
    expect(complete('Call @Marco')).toBe('Call @Marco')
    expect(complete('Renew /due fri')).toBe('Renew /due fri')
    // Unreadable or still partial: stays in the title as typed.
    expect(complete('Renew /due frday')).toBe('Renew /due frday')
    expect(complete('Renew /due 24')).toBe('Renew /due 24')
    // Nothing typed after the trigger or the command: nothing to match.
    expect(complete('Call @')).toBe('Call @')
    expect(complete('Fix /')).toBe('Fix /')
    expect(complete('Renew /due ')).toBe('Renew /due ')
    // An argument command isn't completed without its argument.
    expect(complete('Renew /du')).toBe('Renew /du')
  })
})

describe('isPartialDateArgument', () => {
  it.each(['', 'nex', 'next', 'next f', 'in', 'in 3', 'in 3 da', '2', '24', '24 o', '5/', '5/4/', 'tue 13', 'tue 13 o', 'octo', 'non'])(
    '"%s" could still become a date',
    (t) => expect(isPartialDateArgument(t, 'followup')).toBe(true),
  )
  it.each(['frday', 'soon', 'next x', '24 x', 'in 3 weeks', 'a b c d'])(
    '"%s" cannot',
    (t) => expect(isPartialDateArgument(t, 'due')).toBe(false),
  )
})

describe('tokenTints', () => {
  const tintsOf = (text: string, active?: { start: number; end: number; error: boolean }) => {
    const parsed = parseInput(text, TODAY)
    const resolved = resolveInput(parsed, [{ id: 1, name: 'Priya', initials: 'PR' }], [{ id: 1, name: 'Waiting', color: '#fa0', sortOrder: 0 }])
    return tokenTints(parsed, resolved, active).map((s) => `${text.slice(s.start, s.end)}:${s.tint}`)
  }

  it('tints each recognised token in its colour', () => {
    expect(tintsOf('Call #contracts @Priya @Marco /due fri /urgent /important /focus /followup 2w /repeat weekly /status waiting'))
      .toEqual([
        '#contracts:chip', '@Priya:chip', '@Marco:new', '/due fri:due', '/urgent:urgent', '/important:followup',
        '/focus:accent', '/followup 2w:followup', '/repeat weekly:accent', '/status waiting:chip',
      ])
  })

  it('rings problems; unknown commands stay plain', () => {
    expect(tintsOf('Call plumber /urgnt /due frday /repeat weekly /status nope'))
      .toEqual(['/due frday:error', '/repeat weekly:ignored', '/status nope:error'])
  })

  it('a token being typed is a chip unless it already reads as a command or shows an error', () => {
    expect(tintsOf('x /fo', { start: 2, end: 5, error: false })).toEqual(['/fo:chip'])
    expect(tintsOf('x /due ', { start: 2, end: 7, error: false })).toEqual(['/due :chip'])
    expect(tintsOf('x /due fri', { start: 2, end: 10, error: false })).toEqual(['/due fri:due'])
    expect(tintsOf('x /due frday', { start: 2, end: 12, error: true })).toEqual(['/due frday:error'])
  })
})

describe('carrySelection', () => {
  it('keeps the highlighted command while the same list narrows — by what it is, not its index', () => {
    const a = at('x /')
    const b = at('x /f')
    if (!a || !b) throw new Error('no popup')
    // /followup: 5th in the full list, 2nd under /f.
    const followupAt = a.rows.findIndex((r) => r.kind === 'command' && r.command.name === 'followup')
    expect(followupAt).toBe(4)
    expect(carrySelection(a, followupAt, b)).toBe(1)
    const kept = b.rows[1]
    expect(kept?.kind === 'command' && kept.command.name).toBe('followup')
    // Highlighted a command the narrower list drops: the best match.
    const dueAt = a.rows.findIndex((r) => r.kind === 'command' && r.command.name === 'due')
    expect(carrySelection(a, dueAt, b)).toBe(0)
  })

  it('keeps the highlighted person while narrowing moves them to another index', () => {
    const src = { ...sources, people: [...people, { id: 3, name: 'Danny', initials: 'DY', kind: 'person' as const }] }
    const a = at('x @an', src) // Anna, Dana Kim, Danny (substring)
    const b = at('x @ann', src) // Anna, Danny
    if (!a || !b) throw new Error('no popup')
    const dannyAt = a.rows.findIndex((r) => r.kind === 'entity' && r.item.name === 'Danny')
    expect(dannyAt).toBe(2)
    const kept = b.rows[carrySelection(a, dannyAt, b)]
    expect(kept?.kind === 'entity' && kept.item.name).toBe('Danny')
  })

  it('resets to the first row for another list or trigger', () => {
    const cmd = at('x /due')
    const arg = at('x /due ')
    const other = at('x @a /')
    if (!cmd || !arg || !other) throw new Error('no popup')
    expect(carrySelection(cmd, 2, arg)).toBe(0)
    expect(carrySelection(cmd, 2, other)).toBe(0)
    expect(carrySelection(null, 2, cmd)).toBe(0)
  })
})

describe('candidate builders', () => {
  it('map stored rows only; tags alphabetical, the others in store order', () => {
    expect(personItems([{ id: 2, name: 'Zed', initials: 'Z' }, { name: 'Unsaved', initials: 'U' }, { id: 1, name: 'Amy', initials: 'A', color: '#f00' }]))
      .toEqual([
        { id: 2, name: 'Zed', initials: 'Z', color: undefined, kind: 'person' },
        { id: 1, name: 'Amy', initials: 'A', color: '#f00', kind: 'person' },
      ])
    expect(tagItems([{ id: 1, name: 'zeta', color: '#000' }, { id: 2, name: 'alpha', color: '#111' }]).map((t) => t.name))
      .toEqual(['alpha', 'zeta'])
    expect(statusItems([{ id: 3, name: 'Done', color: '#0f0', icon: 'check', sortOrder: 0 }]))
      .toEqual([{ id: 3, name: 'Done', color: '#0f0', icon: 'check', kind: 'status' }])
  })
})

describe('bestMatchCompletion — the highlighted row', () => {
  it('completes to the row at `index` (default: the first)', () => {
    const view = at('Call @an')
    if (!view) throw new Error('no popup')
    expect(bestMatchCompletion('Call @an', view)).toBe('Call @Anna ')
    expect(bestMatchCompletion('Call @an', view, 1)).toBe('Call @"Dana Kim" ')
  })
})

describe('implicitAccept — typing on uses the highlighted row', () => {
  const open = (text: string) => {
    const view = at(text)
    if (!view) throw new Error('no popup')
    return view
  }
  const typed = (prev: string, index: number, value: string, cursor = value.length) =>
    implicitAccept({ value: prev, view: open(prev), index }, value, cursor, computeAutocomplete(value, cursor, sources))

  it('a space after the token completes it to the highlighted person, the space kept', () => {
    expect(typed('Call @an', 0, 'Call @an ')).toEqual({ value: 'Call @Anna ', cursor: 11 })
    expect(typed('Call @an', 1, 'Call @an ')).toEqual({ value: 'Call @"Dana Kim" ', cursor: 17 })
  })

  it('punctuation does too; a tag completes the same way', () => {
    expect(typed('Call @an', 0, 'Call @an,')).toEqual({ value: 'Call @Anna,', cursor: 11 })
    expect(typed('Plan #ba', 0, 'Plan #ba ')).toEqual({ value: 'Plan #Backend ', cursor: 14 })
  })

  it('moving the caret off the token completes it; the caret stays where it went', () => {
    const text = 'Call @an now'
    const view = computeAutocomplete(text, 8, sources)
    if (!view) throw new Error('no popup')
    // Back to the start: nothing moves before the caret.
    expect(implicitAccept({ value: text, view, index: 0 }, text, 0, computeAutocomplete(text, 0, sources)))
      .toEqual({ value: 'Call @Anna now', cursor: 0 })
    // To the end: the caret moves with the text after the token.
    expect(implicitAccept({ value: text, view, index: 0 }, text, text.length, computeAutocomplete(text, text.length, sources)))
      .toEqual({ value: 'Call @Anna now', cursor: 14 })
    // Within the token: still open, nothing yet.
    expect(implicitAccept({ value: text, view, index: 0 }, text, 7, computeAutocomplete(text, 7, sources))).toBeNull()
  })

  it('nothing when the popup goes on (a letter typed), a create row is highlighted, or nothing was typed after the trigger', () => {
    expect(typed('Call @an', 0, 'Call @ann')).toBeNull()
    const create = open('Call @zed')
    expect(create.rows.map((r) => r.kind)).toEqual(['create'])
    expect(implicitAccept({ value: 'Call @zed', view: create, index: 0 }, 'Call @zed ', 10, null)).toBeNull()
    expect(typed('Call @', 0, 'Call @ ')).toBeNull()
  })

  it('nothing while a quoted name is being typed: its space is part of the name', () => {
    expect(typed('Call @"an', 0, 'Call @"an ')).toBeNull()
  })

  it('nothing for an edit that is neither (a deletion)', () => {
    expect(typed('Call @an', 0, 'Call @a')).toBeNull()
  })
})

describe('# rows and the resolver rank tags the same way', () => {
  it('the exact tag first, then alphabetical prefixes; matchTag is the first row', () => {
    const src = { ...sources, tags: tagItems([
      { id: 1, name: 'q4-review', color: '#000' }, { id: 2, name: 'Q4', color: '#000' }, { id: 3, name: 'q3', color: '#000' },
    ]) }
    expect(labels(at('x #q4', src))).toEqual(['Q4', 'q4-review'])
    expect(labels(at('x #q', src))).toEqual(['q3', 'Q4', 'q4-review', 'create #q'])
    expect(matchTag('q', src.tags)?.name).toBe('q3')
    expect(matchTag('q4', src.tags)?.name).toBe('Q4')
    expect(matchTag('zz', src.tags)).toBeUndefined()
  })
})

describe('a tag no bare #slug can spell (R&D, Q4 plan) is reachable and round-trips', () => {
  const src = { ...sources, tags: tagItems([
    { id: 7, name: 'R&D', color: '#000' }, { id: 8, name: 'Q4 plan', color: '#000' }, { id: 9, name: 'rd', color: '#000' },
  ]) }
  const tagsOf = (text: string) => parseInput(text, TODAY).tags

  it('typing #R& lists it; a pick writes the quoted token, which parses back as the whole name', () => {
    const view = at('Plan #R&', src)
    expect(labels(view)).toEqual(['R&D'])
    const row = view!.rows[0]!
    const picked = applyAutocompletePick('Plan #R&', view!, row)!.value
    expect(picked).toBe('Plan #"R&D" ')
    expect(tagsOf(picked)).toEqual(['R&D'])
    expect(parseInput(picked, TODAY).title).toBe('Plan')
  })

  it('typed then completed: a space after #R& completes to #"R&D"', () => {
    const view = at('Plan #R&', src)!
    const next = computeAutocomplete('Plan #R& ', 9, src)
    expect(implicitAccept({ value: 'Plan #R&', view, index: 0 }, 'Plan #R& ', 9, next)).toEqual({ value: 'Plan #"R&D" ', cursor: 12 })
  })

  it('a quoted name with a space; a bare slug stays bare', () => {
    const view = at('x #"Q4', src)!
    expect(labels(view)).toEqual(['Q4 plan'])
    expect(applyAutocompletePick('x #"Q4', view, view.rows[0]!)!.value).toBe('x #"Q4 plan" ')
    expect(tagsOf('x #"Q4 plan" #rd')).toEqual(['Q4 plan', 'rd'])
  })
})
