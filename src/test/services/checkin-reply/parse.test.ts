import { afterEach, describe, expect, it } from 'vitest'
import { replyNotesLines } from '../../../services/checkin-reply/diff'
import {
  CHECKIN_REPLY_MAX_CHARS,
  isCompletedMarked,
  parseCheckinReply,
  type ParsedCheckinReply,
} from '../../../services/checkin-reply/parse'
import { checkinSampleTasks } from '../../fixtures/checkin-replies/sample-tasks'
import { editHtml, editPlain, parse, sampleEmail } from './helpers'

const REFS = ['0c4d8e17', 'b71e05d9', '3f9a1c42', '9e8d7c6b']

function block(reply: ParsedCheckinReply, ref: string) {
  const b = reply.blocks.find((x) => x.ref === ref)
  if (!b) throw new Error(`no block ${ref}`)
  return b
}

describe('parseCheckinReply — the email as sent', () => {
  it('reads every task, its box and the footer from the HTML', () => {
    const email = sampleEmail()
    const reply = parse({ html: email.html, plain: email.plain })
    expect(reply.source).toBe('html')
    expect(reply.personName).toBe('Marcus Chen')
    expect(reply.sentDate).toBe('2026-10-12')
    expect(reply.orphanUpdates).toBe(0)
    expect(reply.blocks.map((b) => b.ref)).toEqual(REFS)
    expect(reply.blocks.map((b) => b.completed)).toEqual([false, false, false, false])
    expect(reply.blocks.map((b) => b.progress)).toEqual(['half done', '40%', '', ''])
    expect(block(reply, '0c4d8e17').title).toBe('Answer Northwind’s security questionnaire')
    expect(block(reply, '9e8d7c6b').title).toBe('Renew the Contoso support contract — confirm pricing tier & seats (<50 users?)')
    expect(replyNotesLines(block(reply, '3f9a1c42'))).toEqual([
      'Cover the cutover sequence, rollback steps and who is on call.',
      '- Link the existing **DB checklist**',
      '- Ask Nina about the [rollback window](https://example.com/runbook)',
      '- [ ] Dry run on staging',
    ])
    expect(replyNotesLines(block(reply, 'b71e05d9'))).toEqual([])
  })

  it('reads the same from the plain text', () => {
    const email = sampleEmail()
    const reply = parse({ plain: email.plain })
    expect(reply.source).toBe('plain')
    expect(reply.personName).toBe('Marcus Chen')
    expect(reply.sentDate).toBe('2026-10-12')
    expect(reply.blocks.map((b) => b.ref)).toEqual(REFS)
    expect(reply.blocks.map((b) => b.completed)).toEqual([false, false, false, false])
    expect(reply.blocks.map((b) => b.progress)).toEqual(['half done', '40%', '', ''])
    expect(block(reply, '3f9a1c42').notesText).toBe(checkinSampleTasks()[2]?.notes)
    expect(block(reply, '0c4d8e17').notesText).toBe('Sections 4 and 7 still open.\nSam has the SOC 2 letter.')
    expect(block(reply, 'b71e05d9').notesText).toBe('')
  })

  it('has no Notes when the email left them out', () => {
    const email = sampleEmail(undefined, { includeNotes: false })
    for (const reply of [parse({ html: email.html, plain: email.plain }), parse({ plain: email.plain })]) {
      expect(reply.blocks).toHaveLength(4)
      for (const b of reply.blocks) {
        expect(b.notesHtml).toBeUndefined()
        expect(b.notesText).toBeUndefined()
      }
    }
  })

  it('falls back to the plain text when the HTML holds no task', () => {
    const email = sampleEmail()
    const reply = parse({ html: '<p>Sorry, my mail client mangled this.</p>', plain: email.plain })
    expect(reply.source).toBe('plain')
    expect(reply.blocks).toHaveLength(4)
  })

  it('reads nothing from unrelated text', () => {
    const reply = parse({ html: '<p>Hi!</p>', plain: 'Hi!\nSee you Monday.' })
    expect(reply).toEqual({ blocks: [], source: 'none', orphanUpdates: 0 })
  })
})

describe('the Completed box', () => {
  it.each([
    ['[x]', true], ['[X]', true], ['[✓]', true], ['[✔]', true], ['[ x ]', true], ['[*]', true], ['[x ]', true],
    ['x', true], ['X', true], ['yes', true], ['Yes!', true], ['done', true], ['Done.', true], ['✓', true],
    ['[ ]', false], ['[]', false], ['[ ]', false], ['', false], ['no', false], ['[no]', false], ['not yet', false],
    ['[[Marcus Chen] x]', true], ['[Marcus Chen] [ ]', false], ['[x] — finished Friday', true],
  ])('%j → %s', (value, marked) => {
    expect(isCompletedMarked(value)).toBe(marked)
  })

  it('is read from the HTML cell and the plain line', () => {
    const email = sampleEmail()
    const html = editHtml(email.html, 'b71e05d9', 'Completed:', '<p class="MsoNormal"><span style="font-family:Consolas">[X]<o:p></o:p></span></p>')
    expect(block(parse({ html, plain: '' }), 'b71e05d9').completed).toBe(true)
    const bare = editHtml(email.html, 'b71e05d9', 'Completed:', 'x')
    expect(block(parse({ html: bare, plain: '' }), 'b71e05d9').completed).toBe(true)
    const plain = editPlain(email.plain, 'b71e05d9', 'Completed:', ['Completed: [✓]'])
    expect(block(parse({ plain }), 'b71e05d9').completed).toBe(true)
    const plainBare = editPlain(email.plain, 'b71e05d9', 'Completed:', ['Completed: yes'])
    expect(block(parse({ plain: plainBare }), 'b71e05d9').completed).toBe(true)
  })
})

describe('plain-text replies', () => {
  it('drops > quote prefixes, nested ones too', () => {
    const email = sampleEmail()
    const edited = editPlain(email.plain, 'b71e05d9', 'Completed:', ['Completed: [x]'])
    const quoted = ['Done, see below.', '', '-----Original Message-----', ...edited.split('\n').map((l) => (l ? `>> ${l}` : '>'))].join('\r\n')
    const reply = parse({ plain: quoted })
    expect(reply.blocks.map((b) => b.ref)).toEqual(REFS)
    expect(block(reply, 'b71e05d9').completed).toBe(true)
    expect(block(reply, '0c4d8e17').notesText).toBe('Sections 4 and 7 still open.\nSam has the SOC 2 letter.')
    expect(reply.sentDate).toBe('2026-10-12')
  })

  it('reads a value on the line after a label that stands alone (table → text)', () => {
    let plain = sampleEmail().plain
    plain = editPlain(plain, '0c4d8e17', 'Completed:', ['Completed:', '[x]'])
    plain = editPlain(plain, '0c4d8e17', 'Progress:', ['Progress', '', 'all sections drafted'])
    plain = editPlain(plain, '0c4d8e17', 'Notes:', ['Notes', 'One line only.'])
    const b = block(parse({ plain }), '0c4d8e17')
    expect(b).toMatchObject({ completed: true, progress: 'all sections drafted', notesText: 'One line only.' })
  })

  it('reads a tab-separated label and value, and an empty label as empty', () => {
    let plain = sampleEmail().plain
    plain = editPlain(plain, '0c4d8e17', 'Progress:', ['Progress:\tsection 4 done'])
    plain = editPlain(plain, '0c4d8e17', 'Notes:', ['Notes:\tFirst line', 'Second line'])
    const b = block(parse({ plain }), '0c4d8e17')
    expect(b.progress).toBe('section 4 done')
    expect(b.notesText).toBe('First line\nSecond line')
  })

  it('joins a wrapped Progress line', () => {
    const plain = editPlain(sampleEmail().plain, '0c4d8e17', 'Progress:', ['Progress: section 4 done, section 7 waiting on the', 'pen-test report'])
    expect(block(parse({ plain }), '0c4d8e17').progress).toBe('section 4 done, section 7 waiting on the pen-test report')
  })

  it('reads a task line wrapped before its Ref, or with the Ref on its own line', () => {
    const plain = sampleEmail().plain
      .replace('1. Answer Northwind’s security questionnaire  Ref 0c4d8e17', '1. Answer Northwind’s security\nquestionnaire  Ref 0c4d8e17')
      .replace('2. Review the staging load-test results  Ref b71e05d9', '2. Review the staging load-test results\nRef b71e05d9')
    const reply = parse({ plain })
    expect(reply.blocks.map((b) => b.ref)).toEqual(REFS)
    expect(block(reply, '0c4d8e17').title).toBe('Answer Northwind’s security questionnaire')
    expect(block(reply, 'b71e05d9').title).toBe('Review the staging load-test results')
    expect(block(reply, '0c4d8e17').notesText).toBe('Sections 4 and 7 still open.\nSam has the SOC 2 letter.')
  })

  it('reads a Ref cell on its own line after a blank one (table → text)', () => {
    const plain = sampleEmail().plain.replace('2. Review the staging load-test results  Ref b71e05d9', '2. Review the staging load-test results\n\nRef b71e05d9')
    const reply = parse({ plain })
    expect(reply.blocks.map((b) => b.ref)).toEqual(REFS)
    expect(block(reply, 'b71e05d9').progress).toBe('40%')
  })

  it('does not join a numbered notes line to the next task line', () => {
    const plain = editPlain(sampleEmail().plain, '3f9a1c42', 'Notes:', ['Notes:', 'Steps:', '1. numbered line'])
    const reply = parse({ plain })
    expect(reply.blocks.map((b) => b.ref)).toEqual(REFS)
    expect(block(reply, '3f9a1c42').notesText).toBe('Steps:\n1. numbered line')
  })

  it('keeps notes lines that look like labels or boxes as notes', () => {
    let plain = sampleEmail().plain
    plain = editPlain(plain, '0c4d8e17', 'Notes:', ['Notes:', 'Completed: sections 1-3', '- [x] SOC 2 letter received', 'Progress is slow', 'Your update is below'])
    const b = block(parse({ plain }), '0c4d8e17')
    expect(b.completed).toBe(false)
    expect(b.progress).toBe('half done')
    expect(b.notesText).toBe('Completed: sections 1-3\n- [x] SOC 2 letter received\nProgress is slow\nYour update is below')
  })

  it('does not read a later label out of order', () => {
    const plain = editPlain(sampleEmail().plain, '0c4d8e17', 'Progress:', ['Progress: half done', 'Completed the draft'])
    const b = block(parse({ plain }), '0c4d8e17')
    expect(b.completed).toBe(false)
    expect(b.progress).toBe('half done Completed the draft')
  })

  it('ends notes at a section header in capitals (HTML → text uppercases them)', () => {
    const plain = sampleEmail().plain.replace('\nComing up\n', '\nCOMING UP\n')
    expect(block(parse({ plain }), '0c4d8e17').notesText).toBe('Sections 4 and 7 still open.\nSam has the SOC 2 letter.')
  })
})

describe('a deleted Ref line', () => {
  it('HTML: the box under it is ignored and counted; the others are read', () => {
    const email = sampleEmail()
    const doc = new DOMParser().parseFromString(email.html, 'text/html')
    const refCell = [...doc.querySelectorAll('td')].find((td) => td.textContent === 'Ref b71e05d9')
    refCell?.closest('tr')?.remove()
    const reply = parse({ html: doc.body.innerHTML, plain: '' })
    expect(reply.blocks.map((b) => b.ref)).toEqual(['0c4d8e17', '3f9a1c42', '9e8d7c6b'])
    expect(reply.orphanUpdates).toBe(1)
  })

  it('plain: the task above keeps its own notes; the orphan box is counted', () => {
    const plain = sampleEmail().plain
      .replace('2. Review the staging load-test results  Ref b71e05d9\n', '')
      .replace('Coming up\n\n', '')
    const reply = parse({ plain })
    expect(reply.blocks.map((b) => b.ref)).toEqual(['0c4d8e17', '3f9a1c42', '9e8d7c6b'])
    expect(block(reply, '0c4d8e17').notesText).toBe('Sections 4 and 7 still open.\nSam has the SOC 2 letter.')
    expect(reply.orphanUpdates).toBe(1)
  })
})

describe('threads', () => {
  /** The newest check-in on top, an older one (different values) quoted below it. */
  function twoRounds() {
    const tasks = checkinSampleTasks()
    const older = sampleEmail(tasks, { sentAt: new Date(2026, 9, 5, 10) })
    const newer = sampleEmail(tasks.slice(0, 3), { sentAt: new Date(2026, 9, 19, 8) })
    const olderHtml = editHtml(editHtml(older.html, '0c4d8e17', 'Progress:', 'old progress'), '9e8d7c6b', 'Progress:', 'only in the old one')
    const newerHtml = editHtml(newer.html, '0c4d8e17', 'Progress:', 'new progress')
    const olderPlain = editPlain(editPlain(older.plain, '0c4d8e17', 'Progress:', ['Progress: old progress']), '9e8d7c6b', 'Progress:', ['Progress: only in the old one'])
    const newerPlain = editPlain(newer.plain, '0c4d8e17', 'Progress:', ['Progress: new progress'])
    const header = 'From: Marcus Chen <marcus.chen@example.com>\nSent: Monday, October 5, 2026 4:02 PM\nSubject: RE: Task check-in: 4 open tasks'
    return {
      html: `<div>Latest below.</div>${newerHtml}<hr><div id="divRplyFwdMsg">${header.replace(/\n/g, '<br>')}</div><blockquote>${olderHtml}</blockquote>`,
      plain: `Latest below.\n\n${newerPlain}\n\n${header}\n\n${olderPlain.split('\n').map((l) => `> ${l}`).join('\n')}`,
    }
  }

  it.each(['html', 'plain'] as const)('%s: reads only the newest email, up to its footer', (flavour) => {
    const thread = twoRounds()
    const reply = parse(flavour === 'html' ? thread : { plain: thread.plain })
    expect(reply.source).toBe(flavour)
    expect(reply.sentDate).toBe('2026-10-19')
    expect(reply.blocks.map((b) => b.ref)).toEqual(['0c4d8e17', 'b71e05d9', '3f9a1c42'])
    expect(block(reply, '0c4d8e17').progress).toBe('new progress')
  })

  it('keeps the first block when a ref repeats above the footer', () => {
    const email = sampleEmail()
    const first = editHtml(email.html, 'b71e05d9', 'Progress:', 'first')
    const second = editHtml(email.html, 'b71e05d9', 'Progress:', 'second')
    const withoutFooter = (html: string) => html.replace(/Check-in for [^<]*/, '')
    const reply = parse({ html: withoutFooter(first) + second, plain: '' })
    expect(reply.blocks.filter((b) => b.ref === 'b71e05d9')).toHaveLength(1)
    expect(block(reply, 'b71e05d9').progress).toBe('first')
  })
})

describe('the footer', () => {
  it('reads a name that contains the separator and an Org: prefix', () => {
    const email = sampleEmail(undefined, { person: { id: 9, name: 'Org: North · West', initials: 'NW' } })
    expect(parse({ html: email.html, plain: email.plain })).toMatchObject({ personName: 'Org: North · West', sentDate: '2026-10-12' })
    expect(parse({ plain: email.plain })).toMatchObject({ personName: 'Org: North · West', sentDate: '2026-10-12' })
  })

  it('is absent when deleted, and ignores an impossible date', () => {
    const email = sampleEmail()
    const noFooter = parse({ html: email.html.replace(/Check-in for [^<]*/, ''), plain: '' })
    expect(noFooter.personName).toBeUndefined()
    expect(noFooter.sentDate).toBeUndefined()
    const badDate = parse({ plain: email.plain.replace('sent 2026-10-12', 'sent 2026-13-45') })
    expect(badDate.sentDate).toBeUndefined()
  })
})

describe('untrusted HTML', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__checkinPwned
  })

  it('never runs scripts or handlers, never touches the page, and returns clean notes', () => {
    const email = sampleEmail()
    const evil = [
      '<p>Kept line</p>',
      '<script>window.__checkinPwned = "script"</script>',
      '<img src="x" onerror="window.__checkinPwned = \'img\'">',
      '<p onclick="window.__checkinPwned = \'click\'" style="color:red">Clicked <a href="javascript:window.__checkinPwned=1">here</a></p>',
      '<iframe src="https://example.com"></iframe><style>p { color: red }</style>',
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; as text</p>',
    ].join('')
    const html = editHtml(email.html, '0c4d8e17', 'Notes:', evil) + '<script>window.__checkinPwned = "top"</script>'
    const before = document.body.innerHTML

    const reply = parse({ html, plain: '' })

    expect((window as unknown as Record<string, unknown>).__checkinPwned).toBeUndefined()
    expect(document.body.innerHTML).toBe(before)
    const notesHtml = block(reply, '0c4d8e17').notesHtml ?? ''
    expect(notesHtml).not.toMatch(/<script|<img|<iframe|<style|onerror|onclick|style=|javascript:/i)
    expect(replyNotesLines(block(reply, '0c4d8e17'))).toEqual([
      'Kept line',
      'Clicked [here](#)',
      '<script>alert(1)</script> as text',
    ])
  })
})

describe('size', () => {
  it('refuses a paste over the cap without reading it', () => {
    const result = parseCheckinReply({ plain: 'x'.repeat(CHECKIN_REPLY_MAX_CHARS + 1) })
    expect(result).toEqual({ ok: false, error: 'too-large', limit: CHECKIN_REPLY_MAX_CHARS })
    const both = parseCheckinReply({ html: 'x'.repeat(CHECKIN_REPLY_MAX_CHARS), plain: 'y' })
    expect(both.ok).toBe(false)
  })

  it('reads a paste just under the cap quickly, including pathological lines', () => {
    const email = sampleEmail()
    const filler = ' '.repeat(400_000) + 'Ref'
    const longNotes = Array.from({ length: 4000 }, (_, i) => `Line ${i} of a very long note`).join('\n')
    const plain = editPlain(email.plain, '0c4d8e17', 'Notes:', ['Notes:', longNotes, `1. ${filler}`, `${filler} Ref`])
    const html = editHtml(email.html, '0c4d8e17', 'Notes:', `<p>${'word '.repeat(150_000)}</p>`)
    expect(html.length + plain.length).toBeLessThan(CHECKIN_REPLY_MAX_CHARS)
    const start = performance.now()
    const fromHtml = parse({ html, plain })
    const fromPlain = parse({ plain })
    expect(performance.now() - start).toBeLessThan(5000)
    expect(fromHtml.blocks).toHaveLength(4)
    expect(fromPlain.blocks).toHaveLength(4)
    expect(block(fromPlain, '0c4d8e17').notesText?.split('\n').length).toBe(4002)
  })
})
