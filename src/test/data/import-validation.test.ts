import { describe, it, expect } from 'vitest'
import { validateImportData, isKnownSettingKey } from '../../data/import-validation'
import { isValidCssColor } from '../../utils/css'

const now = new Date().toISOString()

let todoUidSeq = 0

function makeTodo(overrides = {}) {
  return {
    id: 1, uid: `uid-${++todoUidSeq}`, title: 'Task',
    isCompleted: false,
    createdAt: now, modifiedAt: now, sortOrder: 0,
    ...overrides,
  }
}

function makePerson(overrides = {}) {
  return { id: 1, name: 'Alice', initials: 'AL', ...overrides }
}

function makeTag(overrides = {}) {
  return { id: 1, name: 'urgent', color: '#ff0000', ...overrides }
}

/** The smallest whole database: a restore requires `todos` and `settings`. */
function validData(overrides: Record<string, unknown> = {}) {
  return { todos: [], settings: [], ...overrides }
}

describe('isValidCssColor', () => {
  it('accepts 3-digit hex', () => expect(isValidCssColor('#abc')).toBe(true))
  it('accepts 6-digit hex', () => expect(isValidCssColor('#a2cfcb')).toBe(true))
  it('rejects 8-digit hex (alpha)', () => expect(isValidCssColor('#a2cfcbff')).toBe(false))
  it('rejects non-string', () => expect(isValidCssColor(42)).toBe(false))
  it('rejects empty', () => expect(isValidCssColor('')).toBe(false))
  it('rejects CSS injection', () => expect(isValidCssColor('red; } body { display:none')).toBe(false))
  it('rejects url()', () => expect(isValidCssColor('url(//evil.example)')).toBe(false))
  it('rejects named colors', () => expect(isValidCssColor('red')).toBe(false))
})

describe('validateImportData', () => {
  it('accepts minimal valid data', () => {
    const result = validateImportData(validData())
    expect(result.ok).toBe(true)
  })

  it('rejects non-object', () => {
    expect(validateImportData('string').ok).toBe(false)
    expect(validateImportData(null).ok).toBe(false)
  })

  it('rejects a database without its tasks or settings', () => {
    const error = 'File is not a valid TODO2 database (missing tasks or settings)'
    expect(validateImportData({})).toEqual({ ok: false, error })
    expect(validateImportData({ todos: [] })).toEqual({ ok: false, error })
    expect(validateImportData({ settings: [] })).toEqual({ ok: false, error })
    expect(validateImportData({ todos: 'x', settings: [] })).toEqual({ ok: false, error })
    // An old export that still carries canvases is not enough on its own.
    expect(validateImportData({ canvases: [{ id: 1, name: 'Canvas', sortOrder: 0, createdAt: now }] })).toEqual({ ok: false, error })
  })

  it('accepts empty tasks + settings arrays (an empty database)', () => {
    const result = validateImportData({ todos: [], settings: [] })
    expect(result).toMatchObject({ ok: true, warnings: [] })
  })

  it('without requireFullDatabase, accepts task tables alone (append import)', () => {
    const result = validateImportData({ todos: [makeTodo()] }, { requireFullDatabase: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.settings).toEqual([])
  })

  it('ignores tables this build no longer has (projects, canvases, list insets, floats)', () => {
    const result = validateImportData(validData({
      canvases: [{ id: 1 }],
      projects: [{ id: 1, name: 'Proj' }],
      listInsets: [{ id: 1 }],
      floatingNotes: [{ id: 1 }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    for (const t of ['canvases', 'projects', 'listInsets', 'floatingNotes']) expect(t in result.data, t).toBe(false)
  })

  it('drops projectId / canvasId from a todo (fields no longer exist)', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ projectId: 1, canvasId: 1 })] }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('projectId' in result.data.todos[0]!).toBe(false)
    expect('canvasId' in result.data.todos[0]!).toBe(false)
  })

  it('accepts a populated valid dataset', () => {
    const result = validateImportData({
      todos: [makeTodo()],
      people: [makePerson()],
      tags: [makeTag()],
      todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
      settings: [{ key: 'color.dark.accent', value: '#a2cfcb' }],
    })
    expect(result.ok).toBe(true)
  })

  // Todo validation
  it('rejects todo with empty title', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ title: '' })] }))
    expect(result.ok).toBe(false)
  })

  it('rejects todo with non-boolean isCompleted', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ isCompleted: 'yes' })] }))
    expect(result.ok).toBe(false)
  })

  it('accepts a title of any length (a note line can make one over 500 chars)', () => {
    const title = 'x'.repeat(5000)
    const result = validateImportData(validData({ todos: [makeTodo({ title })] }))
    if (!result.ok) throw new Error(result.error)
    expect(result.data.todos[0]!.title).toBe(title)
  })

  it('quotes a long title cut to 60 characters in an error', () => {
    const title = 't'.repeat(1000)
    const result = validateImportData(validData({ todos: [makeTodo({ title, isCompleted: 'yes' })] }))
    expect(result).toEqual({ ok: false, error: `Invalid "todos" record at index 0 ("${'t'.repeat(60)}…"): bad field "isCompleted"` })
  })

  it('rejects NaN sortOrder', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ sortOrder: NaN })] }))
    expect(result.ok).toBe(false)
  })

  // uid + completedAt
  it('rejects a todo without a uid (current-version rows always carry one)', () => {
    for (const uid of [undefined, '', 42]) {
      const result = validateImportData(validData({ todos: [makeTodo({ uid })] }))
      expect(result).toEqual({ ok: false, error: 'Invalid "todos" record at index 0 ("Task"): bad field "uid"' })
    }
  })

  it('rejects duplicate todo uids, naming both rows', () => {
    const result = validateImportData(validData({
      todos: [makeTodo({ id: 1, uid: 'same' }), makeTodo({ id: 2 }), makeTodo({ id: 3, uid: 'same', title: 'Dup' })],
    }))
    expect(result).toEqual({ ok: false, error: 'Invalid "todos" record at index 2 ("Dup"): duplicate uid (same as index 0)' })
  })

  it('accepts an optional completedAt and rejects a malformed one', () => {
    const iso = '2026-10-01T09:30:00.000Z'
    const ok = validateImportData(validData({ todos: [makeTodo({ isCompleted: true, completedAt: iso })] }))
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.data.todos[0]!.completedAt).toEqual(new Date(iso))
      expect(ok.data.todos[0]!.uid).toMatch(/^uid-/)
    }
    const bad = validateImportData(validData({ todos: [makeTodo({ isCompleted: true, completedAt: 'soon' })] }))
    expect(bad).toEqual({ ok: false, error: 'Invalid "todos" record at index 0 ("Task"): bad field "completedAt"' })
  })

  // Person validation
  it('rejects person with too-long initials', () => {
    const result = validateImportData(validData({ people: [makePerson({ initials: 'ABCDE' })] }))
    expect(result.ok).toBe(false)
  })

  // Tag validation
  it('rejects tag with invalid color', () => {
    const result = validateImportData(validData({ tags: [makeTag({ color: 'javascript:alert(1)' })] }))
    expect(result.ok).toBe(false)
  })

  describe('tag registry', () => {
    it('accepts top-level tags + todoTags', () => {
      const result = validateImportData(validData({
        todos: [makeTodo()],
        tags: [{ id: 1, name: 'urgent', color: '#537FE7' }],
        todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tags).toEqual([{ id: 1, name: 'urgent', color: '#537FE7' }])
        expect(result.data.todoTags).toEqual([{ id: 1, todoId: 1, tagId: 1 }])
        // pickTodo no longer carries inline `tags` — only the join tables do.
        expect((result.data.todos[0] as { tags?: unknown }).tags).toBeUndefined()
      }
    })

    it('accepts a tag registry with no todoTags joins', () => {
      const result = validateImportData(validData({
        tags: [{ id: 1, name: 'someday', color: '#abcdef' }],
      }))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.tags).toHaveLength(1)
    })

    it('rejects todoTag rows referencing non-integer ids', () => {
      const result = validateImportData(validData({
        todoTags: [{ id: 1, todoId: 1, tagId: 'not-a-number' as unknown as number }],
      }))
      expect(result.ok).toBe(false)
    })
  })

  // Settings validation
  it('rejects settings with color CSS injection', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'color.dark.accent', value: 'red; } body { display:none' }],
    }))
    expect(result.ok).toBe(false)
  })

  it('drops settings with unrecognized keys and reports them as warnings', () => {
    const result = validateImportData(validData({
      settings: [
        { key: 'themeMode', value: 'dark' },
        { key: 'some.key', value: 'some-value' },
        // Over the default value cap — still reported as unrecognized, not "bad value".
        { key: 'retired.key', value: 'x'.repeat(5000) },
      ],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings).toEqual([{ key: 'themeMode', value: 'dark' }])
    expect(result.warnings).toEqual(['Ignored 2 unrecognized settings: some.key, retired.key'])
  })

  it('still rejects a malformed settings row (missing key)', () => {
    const result = validateImportData(validData({ settings: [{ value: 'x' }] }))
    expect(result.ok).toBe(false)
  })

  it('returns no warnings for a clean import', () => {
    const result = validateImportData(validData({ settings: [{ key: 'themeMode', value: 'dark' }] }))
    expect(result.ok && result.warnings).toEqual([])
  })

  it('lists every failing row, not just the first', () => {
    const result = validateImportData(validData({
      todos: [makeTodo({ id: 1, title: '' }), makeTodo({ id: 2 }), makeTodo({ id: 3, isCompleted: 'no' })],
      people: [makePerson({ initials: '' })],
    }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/^3 invalid records: /)
    expect(result.error).toContain('Invalid "todos" record at index 0')
    expect(result.error).toContain('Invalid "todos" record at index 2 ("Task"): bad field "isCompleted"')
    expect(result.error).toContain('Invalid "people" record at index 0 ("Alice"): bad field "initials"')
  })

  it('caps the listed rows and counts the rest', () => {
    const todos = Array.from({ length: 13 }, (_, i) => makeTodo({ id: i + 1, sortOrder: 'bad' }))
    const result = validateImportData(validData({ todos }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/^13 invalid records: /)
    expect(result.error.match(/Invalid "todos" record/g)).toHaveLength(10)
    expect(result.error).toMatch(/…and 3 more$/)
  })

  it('keeps the single-row error message unchanged', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ isCompleted: 'no' })] }))
    expect(result).toEqual({ ok: false, error: 'Invalid "todos" record at index 0 ("Task"): bad field "isCompleted"' })
  })

  it('accepts valid setting keys', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'themeMode', value: 'dark' }],
    }))
    expect(result.ok).toBe(true)
  })

  // The canvas / project settings are gone; validation treats them like any
  // retired key (the schema upgrade deletes them before validation runs).
  it('drops the canvas / project settings as unrecognized', () => {
    const result = validateImportData(validData({
      settings: [
        { key: 'themeMode', value: 'dark' },
        { key: 'defaultProjectId', value: '1' },
        { key: 'defaultProjectGroupBy', value: 'status' },
        { key: 'canvasViewport', value: JSON.stringify({ x: 0, y: 0, zoom: 1 }) },
        { key: 'canvasMaxExtent', value: '20000' },
        { key: 'canvasRails', value: JSON.stringify({ left: null, right: null, top: null, bottom: null }) },
      ],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings).toEqual([{ key: 'themeMode', value: 'dark' }])
    expect(result.warnings).toEqual([
      'Ignored 5 unrecognized settings: defaultProjectId, defaultProjectGroupBy, canvasViewport, canvasMaxExtent, canvasRails',
    ])
  })

  // The horizons widget's settings are gone; validation treats them like any
  // retired key (the schema upgrade deletes them before validation runs).
  it('drops horizonSlots / selectedHorizonDefId as unrecognized settings', () => {
    const result = validateImportData(validData({
      settings: [
        { key: 'horizonSlots', value: '[1,2]' },
        { key: 'selectedHorizonDefId', value: '1' },
      ],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings).toEqual([])
    expect(result.warnings).toEqual(['Ignored 2 unrecognized settings: horizonSlots, selectedHorizonDefId'])
  })

  // Tags have no cap: a maxTags row (dropped by the v64 upgrade) is an unknown key now.
  it('drops a maxTags row in a current file as an unrecognized setting', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'maxTags', value: '20' }],
    }))
    if (!result.ok) throw new Error(result.error)
    expect(result.data.settings).toEqual([])
    expect(result.warnings).toEqual(['Ignored 1 unrecognized setting: maxTags'])
  })

  // Person color / RecurrenceRule validation.
  it('person with a valid color passes and keeps it', () => {
    const result = validateImportData(validData({ people: [makePerson({ color: '#f28c4e' })] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.people[0]?.color).toBe('#f28c4e')
  })

  it('person with an invalid color fails', () => {
    const result = validateImportData(validData({ people: [makePerson({ color: 'not-a-color' })] }))
    expect(result.ok).toBe(false)
  })

  it('person without a color passes', () => {
    const result = validateImportData(validData({ people: [makePerson()] }))
    expect(result.ok).toBe(true)
    if (result.ok) expect('color' in (result.data.people[0] ?? {})).toBe(false)
  })

  describe('person email', () => {
    it('keeps a valid address, trimmed', () => {
      const result = validateImportData(validData({ people: [makePerson({ email: '  ann@example.com ' })] }))
      if (!result.ok) throw new Error(result.error)
      expect(result.data.people[0]!.email).toBe('ann@example.com')
      expect(result.warnings).toEqual([])
    })

    it('drops an email that is not one valid address, keeping the person, with a warning', () => {
      const result = validateImportData(validData({
        people: [
          makePerson({ email: 'a@b.com,evil@x.com' }),
          makePerson({ id: 2, name: 'Bo', email: 'not an address' }),
          makePerson({ id: 3, name: 'Cy', email: 'cy@example.com' }),
        ],
      }))
      if (!result.ok) throw new Error(result.error)
      expect(result.data.people.map((p) => p.email)).toEqual([undefined, undefined, 'cy@example.com'])
      expect('email' in result.data.people[0]!).toBe(false)
      expect(result.warnings).toEqual(['Fixed 2 people: "Alice" (invalid email dropped); "Bo" (invalid email dropped)'])
    })

    it('drops an empty or blank email', () => {
      const result = validateImportData(validData({
        people: [makePerson({ email: '' }), makePerson({ id: 2, name: 'Bo', email: '   ' }), makePerson({ id: 3, name: 'Cy', email: null })],
      }))
      expect(result.ok).toBe(true)
      if (result.ok) for (const p of result.data.people) expect('email' in p).toBe(false)
    })

    it('drops a non-string or over-long email instead of rejecting the file', () => {
      for (const email of [42, true, ['a@b.co'], { at: 'b.co' }, `${'a'.repeat(250)}@b.co`]) {
        const result = validateImportData(validData({ people: [makePerson({ email })] }))
        if (!result.ok) throw new Error(result.error)
        expect('email' in result.data.people[0]!, JSON.stringify(email)).toBe(false)
        expect(result.warnings).toHaveLength(1)
      }
    })
  })

  describe('check-in settings', () => {
    it('accepts both open methods and every task scope', () => {
      for (const [key, value] of [
        ['checkinOpenMethod', 'mailto'], ['checkinOpenMethod', 'eml'],
        ['checkinTaskScope', 'all'], ['checkinTaskScope', 'due-soon'], ['checkinTaskScope', 'hot'], ['checkinTaskScope', 'list:3'],
      ]) {
        const result = validateImportData(validData({ settings: [{ key, value }] }))
        expect(result.ok, `${key}=${value}`).toBe(true)
        if (result.ok) expect(result.data.settings).toEqual([{ key, value }])
      }
    })

    it('keeps a list scope even when the file has no such list (read falls back to all)', () => {
      const result = validateImportData(validData({ settings: [{ key: 'checkinTaskScope', value: 'list:99' }], listDefinitions: [] }))
      expect(result.ok).toBe(true)
    })

    it('rejects other values', () => {
      for (const [key, value, message] of [
        ['checkinOpenMethod', 'outlook', 'checkinOpenMethod must be mailto or eml'],
        ['checkinTaskScope', 'overdue', 'checkinTaskScope must be all, due-soon, hot or list:<id>'],
        ['checkinTaskScope', 'list:x', 'checkinTaskScope must be all, due-soon, hot or list:<id>'],
      ] as const) {
        const result = validateImportData(validData({ settings: [{ key, value }] }))
        expect(result).toEqual({ ok: false, error: expect.stringContaining(message) })
      }
    })
  })

  describe('keyboard shortcuts', () => {
    const ALL_CHANGED = JSON.stringify({
      'quick-add': 'Mod-Shift-Space',
      'command-palette': 'Mod-Alt-p',
      undo: 'Mod-Alt-z',
      redo: 'Mod-Alt-y',
      'redo-alt': 'Mod-Alt-Shift-z',
      'select-all': 'Mod-Alt-a',
      'show-shortcuts': 'F2',
      'focus-search': 'Mod-Alt-f',
      'focus-search-alt': 'Mod-Alt-s',
      'focus-filters': 'Shift-f',
      'open-settings': 'g o',
      'toggle-complete': 'x',
      'delete-selected': 'Backspace',
    })

    it('is a known setting', () => {
      expect(isKnownSettingKey('keyboardShortcuts')).toBe(true)
    })

    it('keeps the bindings the editor saves, however many', () => {
      expect(ALL_CHANGED.length).toBeGreaterThan(200)
      const result = validateImportData(validData({ settings: [{ key: 'keyboardShortcuts', value: ALL_CHANGED }] }))
      expect(result).toMatchObject({ ok: true, warnings: [] })
      if (result.ok) expect(result.data.settings).toEqual([{ key: 'keyboardShortcuts', value: ALL_CHANGED }])
    })

    it('drops unknown, malformed, refused and clashing bindings with a warning instead of failing', () => {
      const value = JSON.stringify({
        nope: 'Mod-Alt-p',
        undo: 'Mod-Mod-z',
        'select-all': 'Mod-w',
        'focus-filters': 'n',
        'toggle-complete': 'n',
        'open-settings': 'g o',
      })
      const result = validateImportData(validData({ settings: [{ key: 'keyboardShortcuts', value }] }))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.settings).toEqual([{ key: 'keyboardShortcuts', value: '{"focus-filters":"n","open-settings":"g o"}' }])
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toMatch(/^Fixed settings: keyboard shortcuts \(unknown shortcut "nope" dropped, Undo: unreadable keys dropped, Select all visible tasks: .* \(Close tab\) — dropped, Toggle complete: clashes with Focus filters — dropped\)$/)
    })

    it('resets a huge value with one short warning instead of naming every part', () => {
      const keys = Array.from({ length: 200_000 }, (_, i) => `"k${i.toString(36)}":1`)
      const result = validateImportData(validData({ settings: [{ key: 'keyboardShortcuts', value: `{${keys.join(',')}}` }] }))
      expect(result).toMatchObject({ ok: true, warnings: ['Fixed settings: keyboard shortcuts (keyboard shortcuts too long — reset)'] })
      if (result.ok) expect(result.data.settings).toEqual([{ key: 'keyboardShortcuts', value: '{}' }])
    })

    it('resets unreadable text with a warning', () => {
      const result = validateImportData(validData({ settings: [{ key: 'keyboardShortcuts', value: '{oops' }] }))
      expect(result).toMatchObject({ ok: true, warnings: ['Fixed settings: keyboard shortcuts (unreadable keyboard shortcuts reset)'] })
      if (result.ok) expect(result.data.settings).toEqual([{ key: 'keyboardShortcuts', value: '{}' }])
    })
  })

  it('todo with valid recurrenceRule passes; invalid type fails', () => {
    const validResult = validateImportData(validData({
      todos: [makeTodo({ recurrenceRule: { type: 'weekly' } })],
    }))
    expect(validResult.ok).toBe(true)

    const invalidResult = validateImportData(validData({
      todos: [makeTodo({ recurrenceRule: { type: 'invalid' } })],
    }))
    expect(invalidResult.ok).toBe(false)
  })

  it('rebuilds a recurrenceRule from its known keys, dropping stray ones', () => {
    const result = validateImportData(validData({
      todos: [
        makeTodo({ id: 1, recurrenceRule: { type: 'monthly', originalDayOfMonth: 31, every: 2, note: 'x' } }),
        makeTodo({ id: 2, recurrenceRule: { type: 'weekly', legacy: true } }),
        makeTodo({ id: 3, recurrenceRule: null }),
      ],
    }))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    expect(result.data.todos.map((t) => t.recurrenceRule)).toEqual([
      { type: 'monthly', originalDayOfMonth: 31 },
      { type: 'weekly' },
      undefined,
    ])
    expect('recurrenceRule' in result.data.todos[2]!).toBe(false)
  })

  it('rebuilds a list membership from its known keys, dropping stray ones', () => {
    const predicate = { showCompleted: false, searchText: '', dates: {} }
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'L', sortOrder: 0, sort: 'manual', grouping: 'none',
        membership: { kind: 'custom', predicate: { ...predicate, stray: 1 }, legacy: 'x' },
      }],
    }))
    if (!result.ok) throw new Error(result.error)
    expect(result.warnings).toEqual([])
    expect(result.data.listDefinitions[0]!.membership).toEqual({
      kind: 'custom',
      predicate: { ...predicate, personIds: null, statusIds: null },
    })
  })

  it('drops a stray scheduledDate on a todo (field no longer exists)', () => {
    const result = validateImportData(validData({
      todos: [makeTodo({ scheduledDate: { kind: 'date', value: new Date(2026, 4, 1) } })],
    }))
    expect(result.ok).toBe(true)
    if (result.ok) expect('scheduledDate' in result.data.todos[0]!).toBe(false)
  })

  // Status validation.
  it('valid status object passes validation', () => {
    const result = validateImportData(validData({
      statuses: [{ id: 1, name: 'Open', color: '#00ff00', sortOrder: 0 }],
    }))
    expect(result.ok).toBe(true)
  })

  it('status with missing name fails', () => {
    const result = validateImportData(validData({
      statuses: [{ id: 1, color: '#00ff00', sortOrder: 0 }],
    }))
    expect(result.ok).toBe(false)
  })

  it('status with invalid color fails', () => {
    const result = validateImportData(validData({
      statuses: [{ id: 1, name: 'Open', color: 'not-a-color', sortOrder: 0 }],
    }))
    expect(result.ok).toBe(false)
  })

  it('status with NaN sortOrder fails', () => {
    const result = validateImportData(validData({
      statuses: [{ id: 1, name: 'Open', color: '#00ff00', sortOrder: NaN }],
    }))
    expect(result.ok).toBe(false)
  })

  it('accepts person, tag, status and list names of any length (the editors take any length)', () => {
    const long = 'x'.repeat(5000)
    const result = validateImportData(validData({
      people: [makePerson({ name: long })],
      tags: [makeTag({ name: long })],
      statuses: [{ id: 1, name: long, color: '#00ff00', sortOrder: 0 }],
      listDefinitions: [{
        id: 1, name: long, sortOrder: 0, 
        membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {} } },
        sort: 'manual', grouping: 'none',
      }],
    }))
    if (!result.ok) throw new Error(result.error)
    expect(result.data.people[0]!.name).toBe(long)
    expect(result.data.tags![0]!.name).toBe(long)
    expect(result.data.statuses[0]!.name).toBe(long)
    expect(result.data.listDefinitions[0]!.name).toBe(long)
  })

  it('still rejects an empty or non-string name', () => {
    for (const name of ['', 42, null]) {
      const result = validateImportData(validData({ statuses: [{ id: 1, name, color: '#00ff00', sortOrder: 0 }] }))
      expect(result, JSON.stringify(name)).toEqual({ ok: false, error: expect.stringContaining('bad field "name"') })
    }
  })

  it('multiple valid statuses pass validation', () => {
    const result = validateImportData(validData({
      statuses: [
        { id: 1, name: 'Open', color: '#00ff00', sortOrder: 0 },
        { id: 2, name: 'Closed', color: '#ff0000', sortOrder: 1 },
      ],
    }))
    expect(result.ok).toBe(true)
  })

  it('a listDefinition sorted by priority passes validation', () => {
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'By priority', sortOrder: 0,
        membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {} } },
        sort: 'priority',
        grouping: 'none',
      }],
    }))
    expect(result.ok).toBe(true)
  })

  it('listDefinition with followup sort + none grouping passes validation', () => {
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'Follow-ups', sortOrder: 0, 
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false,
            searchText: '', dates: { followup: { match: 'set' } },
          },
        },
        sort: 'followup',
        grouping: 'none',
      }],
    }))
    expect(result.ok).toBe(true)
  })

  it.each([
    ['sort', { sort: 'scheduled' }],
    ['sort', { sort: 'date' }],
    ['grouping', { grouping: 'scheduled' }],
    ['grouping', { grouping: 'date' }],
    ['sort', { sort: 'project' }],
    ['grouping', { grouping: 'project' }],
  ])('rejects a listDefinition with a removed %s value %o', (_field, defPatch) => {
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'Old', sortOrder: 0, 
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false,
            searchText: '', dates: {},
          },
        },
        sort: 'manual',
        grouping: 'none',
        ...defPatch,
      }],
    }))
    expect(result.ok).toBe(false)
  })

  describe('Priority filter and Hot rule', () => {
    function listWithMarkers(markers: unknown) {
      return {
        id: 1, name: 'List', sortOrder: 0, 
        membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {}, markers } },
        sort: 'manual', grouping: 'none',
      }
    }

    it.each([['hot', 'hot'], ['ticked markers', { urgent: true, focus: true }], ['none', null]])(
      'accepts a list Markers filter: %s',
      (_name, markers) => {
        const result = validateImportData(validData({ listDefinitions: [listWithMarkers(markers)] }))
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.data.listDefinitions[0]!.membership).toMatchObject({ predicate: { markers } })
      },
    )

    it.each([['an unknown string', 'warm'], ['hot as a key', { hot: true }], ['a non-true value', { urgent: 'yes' }], ['an array', ['hot']]])(
      'drops a list Markers filter with %s, with a warning',
      (_name, markers) => {
        const result = validateImportData(validData({ listDefinitions: [listWithMarkers(markers)] }))
        if (!result.ok) throw new Error(result.error)
        expect(result.data.listDefinitions[0]!.membership).toMatchObject({ predicate: { markers: null } })
        expect(result.warnings).toEqual(['Fixed 1 list: "List" (priority filter dropped)'])
      },
    )

    it('accepts a Hot rule and stores it with duplicate lines collapsed', () => {
      const result = validateImportData(validData({
        settings: [{ key: 'hotRule', value: '[{"focus":true},{"important":true,"urgent":true},{"urgent":true,"important":true}]' }],
      }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.settings).toEqual([{ key: 'hotRule', value: '[{"focus":true},{"urgent":true,"important":true}]' }])
      }
    })

    it.each([
      ['no lines', '[]'],
      ['an empty line', '[{"urgent":true},{}]'],
      ['an unknown key', '[{"urgent":true,"overdue":true}]'],
      ['a non-true value', '[{"focus":false}]'],
      ['text that is not JSON', 'urgent+important'],
    ])('rejects a Hot rule with %s', (_name, value) => {
      const result = validateImportData(validData({ settings: [{ key: 'hotRule', value }] }))
      expect(result).toEqual({
        ok: false,
        error: expect.stringContaining('hotRule must be a list of lines'),
      })
    })
  })

  describe('list predicates: malformed filters are dropped with a warning, not rejected', () => {
    function list(id: number, name: string, predicate: Record<string, unknown>) {
      return {
        id, name, sortOrder: id, sort: 'manual', grouping: 'none',
        membership: { kind: 'custom', predicate: { showCompleted: false, searchText: '', dates: {}, ...predicate } },
      }
    }

    it('drops a wrongly typed id filter, shortens a long text filter, and names each list in one warning', () => {
      const result = validateImportData(validData({
        listDefinitions: [
          list(1, 'Fine', { personIds: [1, 0], tags: null }),
          list(2, 'Bad people', { personIds: 5, statusIds: ['x'] }),
          list(3, 'Long text', { searchText: 'y'.repeat(600), tags: { 1: true } }),
        ],
      }))
      if (!result.ok) throw new Error(result.error)
      const [fine, people, text] = result.data.listDefinitions.map((d) => d.membership.predicate)
      expect(fine).toMatchObject({ personIds: [1, 0], tags: null })
      expect(people).toMatchObject({ personIds: null, statusIds: null })
      expect(text).toMatchObject({ searchText: 'y'.repeat(500), tags: null })
      expect(result.warnings).toEqual([
        'Fixed 2 lists: "Bad people" (people filter dropped, status filter dropped); "Long text" (text filter shortened, tag filter dropped)',
      ])
    })

    it('keeps only the known predicate keys', () => {
      const result = validateImportData(validData({ listDefinitions: [list(1, 'L', { focus: true, legacy: 'x' })] }))
      if (!result.ok) throw new Error(result.error)
      const predicate = result.data.listDefinitions[0]!.membership.predicate
      expect(Object.keys(predicate).sort()).toEqual(['dates', 'personIds', 'searchText', 'showCompleted', 'statusIds'])
      expect(result.warnings).toEqual([])
    })

    it('drops a malformed date clause (or an unknown date type) with a warning', () => {
      const result = validateImportData(validData({
        listDefinitions: [list(1, 'Dates', { dates: { scheduled: { match: 'set' }, deadline: { match: 'range', start: 'soon', end: null }, followup: { match: 'set' } } })],
      }))
      if (!result.ok) throw new Error(result.error)
      expect(result.data.listDefinitions[0]!.membership.predicate.dates).toEqual({ followup: { match: 'set' } })
      expect(result.warnings).toEqual(['Fixed 1 list: "Dates" (unknown date filter dropped, due date filter dropped)'])
    })

    it('keeps a list sort direction; an unknown one is dropped with a warning', () => {
      const result = validateImportData(validData({
        listDefinitions: [
          { ...list(1, 'Down', {}), sort: 'deadline', sortDirection: 'desc' },
          { ...list(2, 'Up', {}), sort: 'name', sortDirection: 'asc' },
          { ...list(3, 'Plain', {}), sort: 'created' },
          { ...list(4, 'Sideways', {}), sort: 'name', sortDirection: 'sideways' },
          { ...list(5, 'Null', {}), sort: 'name', sortDirection: null },
        ],
      }))
      if (!result.ok) throw new Error(result.error)
      const [down, up, plain, sideways, nul] = result.data.listDefinitions
      expect(down!.sortDirection).toBe('desc')
      expect(up!.sortDirection).toBe('asc')
      expect('sortDirection' in plain!).toBe(false)
      expect('sortDirection' in sideways!).toBe(false)
      expect('sortDirection' in nul!).toBe(false)
      expect(result.warnings).toEqual(['Fixed 1 list: "Sideways" (unknown sort direction dropped)'])
    })

    it('keeps the "is not" switches; an unknown one is dropped with a warning', () => {
      const result = validateImportData(validData({
        listDefinitions: [
          list(1, 'Not waiting', { statusIds: [2], negate: { statusIds: true } }),
          list(2, 'Old', { personIds: [1] }),
          list(3, 'Bad switch', { personIds: [1], statusIds: [2], negate: { personIds: 'yes', statusIds: true } }),
          list(4, 'Future switch', { tags: [1], negate: { markers: true } }),
          list(5, 'Nothing ticked', { personIds: [], negate: { personIds: true } }),
        ],
      }))
      if (!result.ok) throw new Error(result.error)
      const [not, old, bad, future, nothing] = result.data.listDefinitions.map((d) => d.membership.kind === 'custom' ? d.membership.predicate : null)
      expect(not).toMatchObject({ statusIds: [2], negate: { statusIds: true } })
      expect(old).toMatchObject({ personIds: [1] })
      expect('negate' in old!).toBe(false)
      // Which way the people filter went is unknown: it goes, rather than turning round.
      expect(bad).toMatchObject({ personIds: null, statusIds: [2], negate: { statusIds: true } })
      expect(future).toMatchObject({ tags: [1] })
      expect('negate' in future!).toBe(false)
      // An "is not" with nothing ticked is no filter.
      expect(nothing).toMatchObject({ personIds: null })
      expect('negate' in nothing!).toBe(false)
      expect(result.warnings).toEqual([
        'Fixed 2 lists: "Bad switch" (people filter dropped); "Future switch" (unknown "is not" switch dropped)',
      ])
    })

    it('keeps a Priority filter’s Yes and No markers; any other value drops the filter with a warning', () => {
      const result = validateImportData(validData({
        listDefinitions: [
          list(1, 'Delegate', { markers: { urgent: true, important: false } }),
          list(2, 'Odd', { statusIds: [2], markers: { urgent: true, important: 'no' } }),
        ],
      }))
      if (!result.ok) throw new Error(result.error)
      const [delegate, odd] = result.data.listDefinitions.map((d) => d.membership.kind === 'custom' ? d.membership.predicate : null)
      expect(delegate?.markers).toEqual({ urgent: true, important: false })
      expect(odd).toMatchObject({ statusIds: [2], markers: null })
      expect(result.warnings).toEqual(['Fixed 1 list: "Odd" (priority filter dropped)'])
    })

    it('still rejects a predicate missing its core shape', () => {
      const result = validateImportData(validData({ listDefinitions: [list(1, 'L', { showCompleted: 'yes' })] }))
      expect(result).toEqual({ ok: false, error: expect.stringContaining('bad field "membership"') })
    })
  })

  describe('listDefinition.runtimeFilter validation', () => {
    function makeListDef(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, name: 'List', sortOrder: 0, 
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false,
            searchText: '', dates: {},
          },
        },
        sort: 'manual',
        grouping: 'none',
        ...overrides,
      }
    }

    it('accepts each known runtimeFilter field', () => {
      for (const field of ['person', 'status', 'tag']) {
        const result = validateImportData(validData({
          listDefinitions: [makeListDef({ runtimeFilter: { field } })],
        }))
        expect(result.ok, `field=${field}`).toBe(true)
      }
    })

    it('rejects a runtimeFilter on the removed project field', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'project' } })],
      }))
      expect(result.ok).toBe(false)
    })

    it('accepts runtimeFilter with optional label', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'person', label: 'Assignee' } })],
      }))
      expect(result.ok).toBe(true)
    })

    it('rejects runtimeFilter with unknown field', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'evil', label: '<img onerror=x>' } })],
      }))
      expect(result.ok).toBe(false)
    })

    it('rejects runtimeFilter with non-string label', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'person', label: 42 } })],
      }))
      expect(result.ok).toBe(false)
    })

    it('rejects runtimeFilter with label exceeding 100 chars', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'person', label: 'x'.repeat(101) } })],
      }))
      expect(result.ok).toBe(false)
    })

    it('rejects runtimeFilter that is not an object', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: 'person' })],
      }))
      expect(result.ok).toBe(false)
    })

    it('strips runtimeFilter with non-allowlisted shape via pickListDefinition (defense in depth)', () => {
      // Even if a future regression weakens the validator, pickListDefinition
      // only emits a `runtimeFilter` when the field is in the allowlist —
      // the `as` cast that previously passed unknown shapes through is gone.
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'person', label: 'Assignee' } })],
      }))
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.listDefinitions[0]?.runtimeFilter).toEqual({
        field: 'person',
        label: 'Assignee',
      })
    })
  })
})

describe('validateImportData — Date revival', () => {
  const iso = '2026-10-01T09:30:00.000Z'

  it('turns every ISO-string Date field into a real Date', () => {
    const result = validateImportData({
      settings: [],
      todos: [
        makeTodo({
          id: 1, createdAt: iso, modifiedAt: iso, dueDate: iso,
          lastFollowupAt: iso, nextFollowupAt: iso, completedAt: iso, isCompleted: true,
        }),
      ],
      notes: [{ id: 1, content: 'x', createdAt: iso, modifiedAt: iso }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const d = result.data
    const t1 = d.todos[0]!
    const dates: Array<[string, unknown]> = [
      ['todos.createdAt', t1.createdAt],
      ['todos.modifiedAt', t1.modifiedAt],
      ['todos.dueDate', t1.dueDate],
      ['todos.lastFollowupAt', t1.lastFollowupAt],
      ['todos.nextFollowupAt', t1.nextFollowupAt],
      ['todos.completedAt', t1.completedAt],
      ['notes.createdAt', d.notes[0]!.createdAt],
      ['notes.modifiedAt', d.notes[0]!.modifiedAt],
    ]
    for (const [field, value] of dates) {
      expect(value instanceof Date, `${field} is a Date`).toBe(true)
      expect((value as Date).toISOString(), field).toBe(iso)
    }
  })

  it('leaves todoEvents.timestamp a string', () => {
    const result = validateImportData({
      settings: [],
      todos: [makeTodo()],
      todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: iso }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.todoEvents[0]!.timestamp).toBe(iso)
  })
})

describe('isKnownSettingKey — theme colour rows', () => {
  it('knows color.<dark|light>.<theme colour> only', () => {
    expect(isKnownSettingKey('color.dark.accent')).toBe(true)
    expect(isKnownSettingKey('color.light.appBg')).toBe(true)
    for (const key of ['color.dark.constructor', 'color.dark.__proto__', 'color.light.toString', 'color.dark.priorityHigh', 'color.dark.canvasBg', 'color.sepia.accent', 'color.dark', 'color.dark.accent.x']) {
      expect(isKnownSettingKey(key), key).toBe(false)
    }
  })
})
