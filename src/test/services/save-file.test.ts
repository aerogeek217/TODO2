import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadedMessage, saveTextFile } from '../../services/save-file'

/** A DOMException as browsers make it (jsdom's doesn't extend Error). */
const domError = (name: string) => Object.assign(new Error(name), { name })

const opts = { text: '{}', suggestedName: 'a.json', description: 'JSON', mimeType: 'application/json', extension: '.json' }

let clicked: string[]

beforeEach(() => {
  clicked = []
  vi.stubGlobal('URL', Object.assign(Object.create(URL), {
    createObjectURL: vi.fn(() => 'blob:x'),
    revokeObjectURL: vi.fn(),
  }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function picker(impl: () => Promise<unknown>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('showSaveFilePicker', fn)
  return fn
}

describe('saveTextFile', () => {
  it('saved: written through the picker, no download', async () => {
    const write = vi.fn()
    picker(async () => ({ createWritable: async () => ({ write, close: vi.fn() }) }))
    expect(await saveTextFile(opts)).toBe('saved')
    expect(write).toHaveBeenCalledWith('{}')
    expect(clicked).toEqual([])
  })

  it('cancelled: the picker was dismissed, nothing is written or downloaded', async () => {
    picker(async () => { throw domError('AbortError') })
    expect(await saveTextFile(opts)).toBe('cancelled')
    expect(clicked).toEqual([])
  })

  it('downloaded: a picker failure is logged, then the text is downloaded instead', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    picker(async () => ({ createWritable: async () => { throw domError('NotAllowedError') } }))
    expect(await saveTextFile(opts)).toBe('downloaded')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[save-file]'), expect.objectContaining({ name: 'NotAllowedError' }))
    expect(clicked).toEqual(['a.json'])
  })

  it('downloaded: without the File System Access API', async () => {
    vi.stubGlobal('showSaveFilePicker', undefined)
    expect(await saveTextFile(opts)).toBe('downloaded')
    expect(clicked).toEqual(['a.json'])
  })
})

describe('downloadedMessage', () => {
  it('names the file and where to look', () => {
    expect(downloadedMessage('a.json')).toBe('Downloaded a.json — check your Downloads folder.')
  })
})
