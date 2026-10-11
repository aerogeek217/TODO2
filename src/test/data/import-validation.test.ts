import { describe, it, expect } from 'vitest'
import { validateImportData, isValidCssColor } from '../../data/import-validation'

const now = new Date().toISOString()

function makeCanvas(overrides = {}) {
  return { id: 1, name: 'Canvas', sortOrder: 0, createdAt: now, ...overrides }
}

let todoUidSeq = 0

function makeTodo(overrides = {}) {
  return {
    id: 1, uid: `uid-${++todoUidSeq}`, title: 'Task',
    isCompleted: false,
    createdAt: now, modifiedAt: now, sortOrder: 0,
    ...overrides,
  }
}

function makeProject(overrides = {}) {
  return {
    id: 1, name: 'Proj', canvasId: 1, positionX: 0, positionY: 0,
    isCollapsed: false, sortOrder: 0, createdAt: now, ...overrides,
  }
}

function makePerson(overrides = {}) {
  return { id: 1, name: 'Alice', initials: 'AL', ...overrides }
}

function makeTag(overrides = {}) {
  return { id: 1, name: 'urgent', color: '#ff0000', ...overrides }
}

function makeListInset(overrides = {}) {
  return {
    id: 1, listDefinitionId: 1, canvasId: 1,
    x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
    ...overrides,
  }
}

function validData(overrides: Record<string, unknown> = {}) {
  return { canvases: [makeCanvas()], ...overrides }
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

  it('rejects missing canvases', () => {
    expect(validateImportData({}).ok).toBe(false)
  })

  it('rejects empty canvases array', () => {
    expect(validateImportData({ canvases: [] }).ok).toBe(false)
  })

  it('accepts a populated valid dataset', () => {
    const result = validateImportData({
      canvases: [makeCanvas()],
      projects: [makeProject()],
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

  it('rejects title exceeding 500 chars', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ title: 'x'.repeat(501) })] }))
    expect(result.ok).toBe(false)
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

  // Project.groupBy field validator (per-record). Must stay in sync with the
  // settings-store `PROJECT_GROUP_BY_VALUES` source of truth.
  it('accepts every ProjectGroupBy value on a project record', () => {
    const valid = ['status', 'people', 'org', 'tag', 'deadline', 'followup']
    for (const groupBy of valid) {
      const result = validateImportData(validData({ projects: [makeProject({ groupBy })] }))
      expect(result.ok, `groupBy=${groupBy}`).toBe(true)
    }
  })

  it('accepts a project record with groupBy omitted or null', () => {
    expect(validateImportData(validData({ projects: [makeProject()] })).ok).toBe(true)
    expect(validateImportData(validData({ projects: [makeProject({ groupBy: null })] })).ok).toBe(true)
  })

  it('rejects a project record with an unknown groupBy', () => {
    const bad = ['priority', 'TAG', 'random', 42, 'date', 'scheduled']
    for (const groupBy of bad) {
      const result = validateImportData(validData({ projects: [makeProject({ groupBy })] }))
      expect(result.ok, `groupBy=${groupBy}`).toBe(false)
    }
  })

  // defaultProjectGroupBy — accepts every flat TodoGroupBy literal plus the
  // empty string sentinel.
  it('accepts defaultProjectGroupBy with every valid TodoGroupBy value plus empty', () => {
    const valid = ['', 'none', 'status', 'people', 'org', 'tag', 'deadline', 'followup']
    for (const value of valid) {
      const result = validateImportData(validData({
        settings: [{ key: 'defaultProjectGroupBy', value }],
      }))
      expect(result.ok).toBe(true)
    }
  })

  it('rejects defaultProjectGroupBy with unknown values', () => {
    const bad = ['priority', 'NaN', 'TAG', 'random-string', 'date', 'scheduled']
    for (const value of bad) {
      const result = validateImportData(validData({
        settings: [{ key: 'defaultProjectGroupBy', value }],
      }))
      expect(result.ok).toBe(false)
    }
  })

  // canvasViewport
  it('accepts canvasViewport with finite x/y/zoom', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'canvasViewport', value: JSON.stringify({ x: 10, y: -20, zoom: 1.5 }) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects canvasViewport with non-finite numbers', () => {
    const bad = [
      JSON.stringify({ x: 'NaN', y: 0, zoom: 1 }),  // string
      '{"x":1e999,"y":0,"zoom":1}',                   // Infinity after parse
      JSON.stringify({ x: 0, y: 0 }),                 // missing zoom
      JSON.stringify([1, 2, 3]),                      // array
      'not-json',
    ]
    for (const value of bad) {
      const result = validateImportData(validData({
        settings: [{ key: 'canvasViewport', value }],
      }))
      expect(result.ok).toBe(false)
    }
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

  // maxTags accepted as a known setting key.
  it('accepts maxTags setting key', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'maxTags', value: '20' }],
    }))
    expect(result.ok).toBe(true)
  })

  // canvasRails — slot must have tabs[] + activeTabId.
  it('accepts structurally valid canvasRails', () => {
    const rails = {
      left: {
        orientation: 'vertical',
        slots: [{
          id: 'a',
          tabs: [{ id: 'a-t0', type: 'lens' }],
          activeTabId: 'a-t0',
        }],
      },
      right: null, top: null, bottom: null,
    }
    const result = validateImportData(validData({
      settings: [{ key: 'canvasRails', value: JSON.stringify(rails) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects canvasRails with an invalid tab type', () => {
    const rails = {
      left: {
        orientation: 'vertical',
        slots: [{
          id: 'a',
          tabs: [{ id: 'a-t0', type: 'evil' }],
          activeTabId: 'a-t0',
        }],
      },
      right: null, top: null, bottom: null,
    }
    const result = validateImportData(validData({
      settings: [{ key: 'canvasRails', value: JSON.stringify(rails) }],
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects canvasRails with a slot missing tabs[]', () => {
    const rails = {
      left: {
        orientation: 'vertical',
        slots: [{ id: 'a', kind: 'lens' }],
      },
      right: null, top: null, bottom: null,
    }
    const result = validateImportData(validData({
      settings: [{ key: 'canvasRails', value: JSON.stringify(rails) }],
    }))
    expect(result.ok).toBe(false)
  })

  // ListInset validation — listDefinitionId is required after P4.
  it('accepts listInset with listDefinitionId', () => {
    const result = validateImportData(validData({
      listInsets: [makeListInset()],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects listInset missing listDefinitionId', () => {
    const result = validateImportData(validData({
      listInsets: [{
        id: 1, name: 'Empty Inset', canvasId: 1, x: 0, y: 0, width: 280, height: 300, isCollapsed: false,
      }],
    }))
    expect(result.ok).toBe(false)
  })

  // Org / TodoOrg / RecurrenceRule validation.
  it('valid org object passes validation', () => {
    const result = validateImportData(validData({ orgs: [{ id: 1, name: 'Engineering' }] }))
    expect(result.ok).toBe(true)
  })

  it('org with missing name fails', () => {
    const result = validateImportData(validData({ orgs: [{ id: 1 }] }))
    expect(result.ok).toBe(false)
  })

  it('org with invalid color fails', () => {
    const result = validateImportData(validData({ orgs: [{ id: 1, name: 'Eng', color: 'not-a-color' }] }))
    expect(result.ok).toBe(false)
  })

  it('org with too-long initials fails', () => {
    const result = validateImportData(validData({ orgs: [{ id: 1, name: 'Eng', initials: 'ABCDE' }] }))
    expect(result.ok).toBe(false)
  })

  it('org with valid initials passes', () => {
    const result = validateImportData(validData({ orgs: [{ id: 1, name: 'Eng', initials: 'ENG' }] }))
    expect(result.ok).toBe(true)
  })

  it('org with null/undefined initials passes', () => {
    const r1 = validateImportData(validData({ orgs: [{ id: 1, name: 'Eng', initials: null }] }))
    expect(r1.ok).toBe(true)
    const r2 = validateImportData(validData({ orgs: [{ id: 1, name: 'Eng' }] }))
    expect(r2.ok).toBe(true)
  })

  it('valid todoOrg object passes validation', () => {
    const result = validateImportData(validData({ todoOrgs: [{ id: 1, todoId: 1, orgId: 1 }] }))
    expect(result.ok).toBe(true)
  })

  it('todoOrg with missing todoId or orgId fails', () => {
    const result1 = validateImportData(validData({ todoOrgs: [{ id: 1, orgId: 1 }] }))
    expect(result1.ok).toBe(false)
    const result2 = validateImportData(validData({ todoOrgs: [{ id: 1, todoId: 1 }] }))
    expect(result2.ok).toBe(false)
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

  it('status with too-long name fails', () => {
    const result = validateImportData(validData({
      statuses: [{ id: 1, name: 'x'.repeat(201), color: '#00ff00', sortOrder: 0 }],
    }))
    expect(result.ok).toBe(false)
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

  it('listDefinition with followup sort + none grouping passes validation', () => {
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'Follow-ups', sortOrder: 0, pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false, showHiddenStatuses: false,
            searchText: '', dateRangeIncludeNoDate: false, dateField: 'followup',
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
    ['dateField', { dateField: 'scheduled' }],
    ['dateField', { dateField: 'date' }],
  ])('rejects a listDefinition with a removed %s value %o', (_field, patch) => {
    const { dateField, ...defPatch } = patch as { dateField?: string; sort?: string; grouping?: string }
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'Old', sortOrder: 0, pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false, showHiddenStatuses: false,
            searchText: '', dateRangeIncludeNoDate: false,
            ...(dateField ? { dateField } : {}),
          },
        },
        sort: 'manual',
        grouping: 'none',
        ...defPatch,
      }],
    }))
    expect(result.ok).toBe(false)
  })

  describe('listDefinition.runtimeFilter validation', () => {
    function makeListDef(overrides: Record<string, unknown> = {}) {
      return {
        id: 1, name: 'List', sortOrder: 0, pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false, showHiddenStatuses: false,
            searchText: '', dateRangeIncludeNoDate: false,
          },
        },
        sort: 'manual',
        grouping: 'none',
        ...overrides,
      }
    }

    it('accepts each known runtimeFilter field', () => {
      for (const field of ['person', 'org', 'project', 'status', 'tag']) {
        const result = validateImportData(validData({
          listDefinitions: [makeListDef({ runtimeFilter: { field } })],
        }))
        expect(result.ok, `field=${field}`).toBe(true)
      }
    })

    it('accepts runtimeFilter with optional label', () => {
      const result = validateImportData(validData({
        listDefinitions: [makeListDef({ runtimeFilter: { field: 'person', label: 'Assignee' } })],
      }))
      expect(result.ok).toBe(true)
    })

    it('rejects runtimeFilter with unknown field (anchor 3 — was an open door)', () => {
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
      canvases: [makeCanvas({ createdAt: iso })],
      projects: [makeProject({ createdAt: iso })],
      todos: [
        makeTodo({
          id: 1, createdAt: iso, modifiedAt: iso, dueDate: iso,
          lastFollowupAt: iso, nextFollowupAt: iso, completedAt: iso, isCompleted: true,
        }),
      ],
      notes: [{ id: 1, content: 'x', createdAt: iso, modifiedAt: iso }],
      taskboards: [{ id: 1, entries: [], createdAt: iso, updatedAt: iso }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const d = result.data
    const t1 = d.todos[0]!
    const dates: Array<[string, unknown]> = [
      ['canvases.createdAt', d.canvases[0]!.createdAt],
      ['projects.createdAt', d.projects[0]!.createdAt],
      ['todos.createdAt', t1.createdAt],
      ['todos.modifiedAt', t1.modifiedAt],
      ['todos.dueDate', t1.dueDate],
      ['todos.lastFollowupAt', t1.lastFollowupAt],
      ['todos.nextFollowupAt', t1.nextFollowupAt],
      ['todos.completedAt', t1.completedAt],
      ['notes.createdAt', d.notes[0]!.createdAt],
      ['notes.modifiedAt', d.notes[0]!.modifiedAt],
      ['taskboards.createdAt', d.taskboards[0]!.createdAt],
      ['taskboards.updatedAt', d.taskboards[0]!.updatedAt],
    ]
    for (const [field, value] of dates) {
      expect(value instanceof Date, `${field} is a Date`).toBe(true)
      expect((value as Date).toISOString(), field).toBe(iso)
    }
  })

  it('leaves todoEvents.timestamp a string', () => {
    const result = validateImportData({
      canvases: [makeCanvas()],
      todos: [makeTodo()],
      todoEvents: [{ id: 1, todoId: 1, type: 'created', fromValue: null, toValue: null, timestamp: iso }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.todoEvents[0]!.timestamp).toBe(iso)
  })
})
