import { describe, expect, it } from 'vitest'
import type { PersistedPerson } from '../../models'
import { parseInput } from '../../services/natural-language-parser'
import { expectWithin } from '../timing'
import {
  appendTextToken,
  chipSpans,
  FOLLOWUP_NONE_TOKEN,
  removeChip,
  removeTextSpans,
  type QuickAddChip,
} from '../../services/nlp-chip-edit'

const today = new Date(2026, 9, 14) // a Wednesday
const anna: PersistedPerson = { id: 1, name: 'Anna', initials: 'AN' }
const bob: PersistedPerson = { id: 2, name: 'Bob', initials: 'BO' }
const people = [anna, bob]

/** `text` without `chip`, the caret at the end before the edit. */
function cut(text: string, chip: QuickAddChip, caret = text.length) {
  return removeChip(text, parseInput(text, today), chip, people, caret)
}

describe('removeTextSpans', () => {
  it('cuts a token between words, leaving one space', () => {
    expect(removeTextSpans('Fix #a now', [{ start: 4, end: 6 }], 0)).toEqual({ text: 'Fix now', caret: 0 })
  })

  it('cuts a token at the start without a leading space', () => {
    expect(removeTextSpans('#a Fix', [{ start: 0, end: 2 }], 6)).toEqual({ text: 'Fix', caret: 3 })
  })

  it('cuts a token at the end without a trailing space', () => {
    expect(removeTextSpans('Fix #a', [{ start: 4, end: 6 }], 6)).toEqual({ text: 'Fix', caret: 3 })
  })

  it('keeps the rest of the spacing as typed', () => {
    expect(removeTextSpans('Fix  the #a  build', [{ start: 9, end: 11 }], 0).text).toBe('Fix  the  build')
  })

  it('cuts several spans in one go', () => {
    const text = '#a Fix #b the #c build #d'
    const spans = [{ start: 0, end: 2 }, { start: 7, end: 9 }, { start: 14, end: 16 }, { start: 23, end: 25 }]
    expect(removeTextSpans(text, spans, text.length)).toEqual({ text: 'Fix the build', caret: 13 })
  })

  it('keeps the caret before a cut, moves it back after one, and to the cut when inside it', () => {
    const text = 'Call #work Bob'
    const span = [{ start: 5, end: 10 }]
    expect(removeTextSpans(text, span, 2).caret).toBe(2)
    expect(removeTextSpans(text, span, 7).caret).toBe(5) // inside `#work`
    expect(removeTextSpans(text, span, 14)).toEqual({ text: 'Call Bob', caret: 8 })
  })

  it('leaves the text alone with no spans, and ignores spans out of range', () => {
    expect(removeTextSpans('Fix it', [], 3)).toEqual({ text: 'Fix it', caret: 3 })
    expect(removeTextSpans('Fix it', [{ start: 4, end: 20 }], 3)).toEqual({ text: 'Fix it', caret: 3 })
  })

  it('a token that is the whole text leaves an empty text', () => {
    expect(removeTextSpans('#a', [{ start: 0, end: 2 }], 2)).toEqual({ text: '', caret: 0 })
  })
})

describe('removeTextSpans on a huge paste', () => {
  it('stays fast: 25,000 tokens cut from a pasted 100,000-character text', () => {
    const text = '#a '.repeat(33_000).trimEnd()
    const spans = Array.from({ length: 25_000 }, (_, i) => ({ start: i * 3, end: i * 3 + 2 }))
    expectWithin(500, () => {
      const { text: out } = removeTextSpans(text, spans, text.length)
      expect(out.length).toBe(text.length - 25_000 * 3)
    })
  })
})

describe('appendTextToken', () => {
  it('adds the token after the last word; the caret stays', () => {
    expect(appendTextToken('Vendor', FOLLOWUP_NONE_TOKEN, 6)).toEqual({ text: 'Vendor /followup none', caret: 6 })
    expect(appendTextToken('Call vendor', FOLLOWUP_NONE_TOKEN, 2)).toEqual({ text: 'Call vendor /followup none', caret: 2 })
  })

  it('a caret in the trailing space moves past the token, so typing goes on after it', () => {
    expect(appendTextToken('Vendor ', FOLLOWUP_NONE_TOKEN, 7)).toEqual({ text: 'Vendor /followup none ', caret: 22 })
  })

  it('with no text yet: the token and a space, the caret after them', () => {
    expect(appendTextToken('', FOLLOWUP_NONE_TOKEN, 0)).toEqual({ text: '/followup none ', caret: 15 })
    expect(appendTextToken('  ', FOLLOWUP_NONE_TOKEN, 1)).toEqual({ text: '/followup none ', caret: 15 })
  })

  it('the appended token reads as /followup none', () => {
    const { text } = appendTextToken('Vendor /due fri', FOLLOWUP_NONE_TOKEN, 0)
    const parsed = parseInput(text, today)
    expect(parsed.followupNone).toBe(true)
    expect(parsed.title).toBe('Vendor')
  })
})

describe('removeChip — per chip kind', () => {
  it('a tag: every token of it, in any case', () => {
    expect(cut('Fix #Work the #work build', { kind: 'tag', name: 'Work' }).text).toBe('Fix the build')
    expect(cut('Fix #work #home', { kind: 'tag', name: 'work' }).text).toBe('Fix #home')
  })

  it('a known person: every token that names them (name, initials, quoted)', () => {
    expect(cut('Call @Anna and @an', { kind: 'person', personId: 1 }).text).toBe('Call and')
    expect(cut('Call @"Anna" @Bob', { kind: 'person', personId: 1 }).text).toBe('Call @Bob')
  })

  it('a new person: the tokens naming them, not a known person', () => {
    expect(cut('Ask @Marco @Bob @marco', { kind: 'newPerson', name: 'Marco' }).text).toBe('Ask @Bob')
  })

  it('a marker: every token of that command', () => {
    expect(cut('Ship it /urgent /important /urgent', { kind: 'marker', marker: 'urgent' }).text).toBe('Ship it /important')
  })

  it('the due date: its command with the argument', () => {
    expect(cut('Pay rent /due 10/30 now', { kind: 'command', command: 'due' }).text).toBe('Pay rent now')
  })

  it('a repeated command goes with the first, so the chip goes', () => {
    const text = 'Pay /due fri /due mon rent'
    expect(parseInput(text, today).problems.map((p) => p.kind)).toEqual(['duplicate'])
    const after = cut(text, { kind: 'command', command: 'due' }).text
    expect(after).toBe('Pay rent')
    expect(parseInput(after, today).dueDate).toBeUndefined()
  })

  it('an unreadable command of the same name stays (it has its own problem line)', () => {
    expect(cut('Pay /due fri /due frday', { kind: 'command', command: 'due' }).text).toBe('Pay /due frday')
  })

  it('the follow-up: back to the default; `/followup none` likewise', () => {
    expect(cut('Vendor /followup 2w', { kind: 'command', command: 'followup' }).text).toBe('Vendor')
    const none = cut('Vendor /followup none', { kind: 'command', command: 'followup' }).text
    expect(none).toBe('Vendor')
    expect(parseInput(none, today).followupNone).toBe(false)
  })

  it('default → none → default round trip', () => {
    const start = 'Vendor call'
    const off = appendTextToken(start, FOLLOWUP_NONE_TOKEN, start.length)
    expect(parseInput(off.text, today).followupNone).toBe(true)
    const back = cut(off.text, { kind: 'command', command: 'followup' }, off.caret)
    expect(back).toEqual({ text: start, caret: start.length })
  })

  it('removing /due leaves /repeat to the Ignored problem', () => {
    const after = cut('Standup /due today /repeat daily', { kind: 'command', command: 'due' }).text
    expect(after).toBe('Standup /repeat daily')
    expect(parseInput(after, today).problems.map((p) => p.kind)).toEqual(['ignored'])
  })

  it('the repeat and the status', () => {
    expect(cut('Standup /due today /repeat daily', { kind: 'command', command: 'repeat' }).text).toBe('Standup /due today')
    expect(cut('Fix /status Doing now', { kind: 'command', command: 'status' }).text).toBe('Fix now')
  })

  it('a quoted status name goes whole', () => {
    expect(cut('Fix /status "In review" now', { kind: 'command', command: 'status' }).text).toBe('Fix now')
  })

  it('the title words are never touched', () => {
    const text = 'Email bob@acme.com about 5/4 #x'
    expect(cut(text, { kind: 'tag', name: 'x' }).text).toBe('Email bob@acme.com about 5/4')
  })

  it('a chip with no token left changes nothing', () => {
    expect(chipSpans(parseInput('Fix it', today), { kind: 'tag', name: 'x' }, people)).toEqual([])
    expect(cut('Fix it', { kind: 'command', command: 'due' }, 3)).toEqual({ text: 'Fix it', caret: 3 })
  })
})
