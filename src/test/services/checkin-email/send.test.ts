import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckinEmail } from '../../../services/checkin-email/build'
import { checkinEmlFileName, openMailtoLink } from '../../../services/checkin-email/handoff'
import { sendCheckinEmail } from '../../../services/checkin-email/send'

const email: CheckinEmail = {
  to: 'ada@example.com',
  subject: 'Task check-in: 2 open tasks',
  html: '<div><p>Hi Ada,</p><td>Ref abcd1234</td></div>',
  plain: 'Hi Ada,\n\n1. One  Ref abcd1234',
}
const sentAt = new Date(2026, 9, 12, 9, 30)

/** What happened, in order: clipboard writes and anchor clicks. */
let events: string[]
let clicked: HTMLAnchorElement[]
let blobs: Blob[]
let objectUrlDescriptors: Partial<Record<'createObjectURL' | 'revokeObjectURL', PropertyDescriptor | undefined>>

function stubClipboard(ok: boolean) {
  const write = vi.fn(async (items: Array<{ data: Record<string, Blob> }>) => {
    events.push('clipboard')
    if (!ok) throw new Error('denied')
    return items
  })
  const writeText = vi.fn(async () => {
    events.push('clipboard-text')
    if (!ok) throw new Error('denied')
  })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } })
  vi.stubGlobal('ClipboardItem', class {
    constructor(public data: Record<string, Blob>) {}
  })
  return write
}

beforeEach(() => {
  events = []
  clicked = []
  blobs = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    events.push('anchor')
    clicked.push(this)
  })
  objectUrlDescriptors = {
    createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
    revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
  }
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true, writable: true,
    value: (b: Blob) => { blobs.push(b); return 'blob:checkin' },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => {} })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
  for (const key of ['createObjectURL', 'revokeObjectURL'] as const) {
    const d = objectUrlDescriptors[key]
    if (d) Object.defineProperty(URL, key, d)
    else Reflect.deleteProperty(URL, key)
  }
})

describe('sendCheckinEmail — open in the mail app', () => {
  it('puts the body on the clipboard first, then opens the mailto: link in a new browsing context', async () => {
    const write = stubClipboard(true)
    expect(await sendCheckinEmail({ email, personName: 'Ada Lovelace', method: 'mailto', sentAt })).toBe('opened')
    expect(events).toEqual(['clipboard', 'anchor'])
    const [[items]] = write.mock.calls as unknown as [[Array<{ data: Record<string, Blob> }>]]
    expect(await items[0]?.data['text/html']?.text()).toBe(email.html)
    expect(await items[0]?.data['text/plain']?.text()).toBe(email.plain)
    const a = clicked[0]!
    expect(a.getAttribute('href')).toBe('mailto:ada@example.com?subject=Task%20check-in%3A%202%20open%20tasks')
    expect(a.target).toBe('_blank')
    expect(a.rel).toContain('noopener')
    expect(a.isConnected).toBe(false) // removed again
  })

  it('starts the clipboard write synchronously, inside the click', () => {
    stubClipboard(true)
    void sendCheckinEmail({ email, personName: 'Ada Lovelace', method: 'mailto', sentAt })
    expect(events).toEqual(['clipboard'])
  })

  it('copies and opens nothing for an address that is not one valid address', async () => {
    stubClipboard(true)
    for (const method of ['mailto', 'eml'] as const) {
      const to = 'ada@example.com,evil@x.com'
      expect(await sendCheckinEmail({ email: { ...email, to }, personName: 'Ada', method, sentAt })).toBe('invalid-address')
    }
    expect(events).toEqual([])
    expect(blobs).toEqual([])
  })

  it('opens nothing when the clipboard refuses', async () => {
    stubClipboard(false)
    expect(await sendCheckinEmail({ email, personName: 'Ada Lovelace', method: 'mailto', sentAt })).toBe('copy-failed')
    expect(events).not.toContain('anchor')
  })
})

describe('sendCheckinEmail — .eml draft', () => {
  it('downloads Check-in - <name> - <date>.eml without touching the clipboard', async () => {
    stubClipboard(true)
    expect(await sendCheckinEmail({ email, personName: 'Ada Lovelace', method: 'eml', sentAt })).toBe('downloaded')
    expect(events).toEqual(['anchor'])
    expect(clicked[0]!.download).toBe('Check-in - Ada Lovelace - 2026-10-12.eml')
    expect(clicked[0]!.target).toBe('')
    const blob = blobs[0]!
    expect(blob.type).toBe('message/rfc822')
    const text = await blob.text()
    expect(text).toMatch(/^X-Unsent: 1\r\n/)
    expect(text).toContain('To: "Ada Lovelace" <ada@example.com>\r\n')
    expect(text).toContain('Subject: Task check-in: 2 open tasks\r\n')
  })
})

describe('checkinEmlFileName', () => {
  it('replaces characters a file name cannot hold', () => {
    expect(checkinEmlFileName('Org: A/B <C>\n"D"?', sentAt)).toBe('Check-in - Org A B C D - 2026-10-12.eml')
    expect(checkinEmlFileName(' \t ', sentAt)).toBe('Check-in - person - 2026-10-12.eml')
  })
})

describe('openMailtoLink', () => {
  it('clicks a temporary new-context anchor and leaves nothing behind', () => {
    const before = document.body.childElementCount
    openMailtoLink('mailto:x@example.com')
    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.target).toBe('_blank')
    expect(document.body.childElementCount).toBe(before)
  })
})
