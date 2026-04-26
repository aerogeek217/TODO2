import { describe, it, expect } from 'vitest'
import { validateImportData, isValidCssColor } from '../../data/import-validation'

const now = new Date().toISOString()

function makeCanvas(overrides = {}) {
  return { id: 1, name: 'Canvas', sortOrder: 0, createdAt: now, ...overrides }
}

function makeTodo(overrides = {}) {
  return {
    id: 1, title: 'Task',
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
  return { id: 1, name: 'Alice', initials: 'AL', color: '#537FE7', ...overrides }
}

function makeTag(overrides = {}) {
  return { id: 1, name: 'urgent', color: '#ff0000', ...overrides }
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

  it('accepts full valid dataset', () => {
    const result = validateImportData({
      canvases: [makeCanvas()],
      projects: [makeProject()],
      todos: [makeTodo()],
      people: [makePerson()],
      tags: [makeTag()],
      todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
      settings: [{ key: 'color.accent', value: '#a2cfcb' }],
    })
    expect(result.ok).toBe(true)
  })

  // Todo validation
  it('rejects todo with empty title', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ title: '' })] }))
    expect(result.ok).toBe(false)
  })

  it('rejects todo with invalid priority', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ priority: 99 })] }))
    expect(result.ok).toBe(false)
  })

  it('rejects todo with non-boolean isCompleted', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ isCompleted: 'yes' })] }))
    expect(result.ok).toBe(false)
  })

  // Person validation
  it('rejects person with CSS-injection color', () => {
    const result = validateImportData(validData({ people: [makePerson({ color: 'red; display:none' })] }))
    expect(result.ok).toBe(false)
  })

  it('rejects person with too-long initials', () => {
    const result = validateImportData(validData({ people: [makePerson({ initials: 'ABCDE' })] }))
    expect(result.ok).toBe(false)
  })

  // Tag validation
  it('rejects tag with invalid color', () => {
    const result = validateImportData(validData({ tags: [makeTag({ color: 'javascript:alert(1)' })] }))
    expect(result.ok).toBe(false)
  })

  // Post-v36 export shape: top-level tags + todoTags coexist with legacy
  // inline `todo.tags` (from pre-v37 exports). Same validators; inline
  // passes through for restore-side translation.
  describe('v36 tag registry + inline tags coexistence', () => {
    it('accepts a full post-v36 shape with tags, todoTags, and inline tags', () => {
      const result = validateImportData(validData({
        todos: [makeTodo({ tags: ['urgent'] })],
        tags: [{ id: 1, name: 'urgent', color: '#537FE7' }],
        todoTags: [{ id: 1, todoId: 1, tagId: 1 }],
      }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.data.tags).toEqual([{ id: 1, name: 'urgent', color: '#537FE7' }])
        expect(result.data.todoTags).toEqual([{ id: 1, todoId: 1, tagId: 1 }])
        expect((result.data.todos[0] as { tags?: unknown }).tags).toEqual(['urgent'])
      }
    })

    it('accepts post-v36 shape with tag registry but no todoTags joins', () => {
      // A user can have Tag rows without any assignments yet.
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

  // Post-v37: inline `todo.tags` is no longer a first-class model field, but
  // the import path carries it through untouched so `restoreFromImportData`
  // can translate legacy inline-only backups into the registry before
  // stripping.
  describe('legacy inline todo.tags pass-through', () => {
    it('accepts and passes inline tags through for restore-side translation', () => {
      const result = validateImportData(validData({
        todos: [makeTodo({ tags: ['urgent', 'today'] })],
      }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect((result.data.todos[0] as { tags?: unknown }).tags).toEqual(['urgent', 'today'])
      }
    })

    it('strips empty tags arrays at pickTodo (omitted-when-empty)', () => {
      const result = validateImportData(validData({ todos: [makeTodo({ tags: [] })] }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect((result.data.todos[0] as { tags?: unknown }).tags).toBeUndefined()
      }
    })

    it('omits the field when absent on input', () => {
      const result = validateImportData(validData({ todos: [makeTodo()] }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect((result.data.todos[0] as { tags?: unknown }).tags).toBeUndefined()
      }
    })
  })

  // Settings validation
  it('rejects settings with color CSS injection', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'color.accent', value: 'red; } body { display:none' }],
    }))
    expect(result.ok).toBe(false)
  })

  it('rejects settings with unrecognized keys', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'some.key', value: 'some-value' }],
    }))
    expect(result.ok).toBe(false)
  })

  it('accepts valid setting keys', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'themeMode', value: 'dark' }],
    }))
    expect(result.ok).toBe(true)
  })

  // `dashboardUserLists`, `notesPinnedToDashboard`, `dashboardTopOrder` are
  // dormant Dashboard-era keys: validation accepts them so older backups
  // still import, but restore strips them (see code-review-2026-04-25 P8).
  // Length-bounded only.
  it('accepts dormant Dashboard-era keys as legacy payloads', () => {
    const cases = [
      { key: 'dashboardUserLists', value: JSON.stringify([1, 2, 3]) },
      { key: 'dashboardUserLists', value: '' },
      { key: 'notesPinnedToDashboard', value: 'true' },
      { key: 'notesPinnedToDashboard', value: 'whatever' },
      { key: 'dashboardTopOrder', value: JSON.stringify(['horizon', 'taskboard']) },
      { key: 'dashboardTopOrder', value: '[]' },
    ]
    for (const setting of cases) {
      const result = validateImportData(validData({ settings: [setting] }))
      expect(result.ok, `key=${setting.key} value=${setting.value}`).toBe(true)
    }
  })

  // Project.groupBy field validator (per-record). Must stay in sync with the
  // settings-store `PROJECT_GROUP_BY_VALUES` source of truth.
  it('accepts every ProjectGroupBy value on a project record', () => {
    const valid = ['status', 'people', 'org', 'tag', 'scheduled', 'deadline', 'date']
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
    const bad = ['priority', 'TAG', 'random', 42]
    for (const groupBy of bad) {
      const result = validateImportData(validData({ projects: [makeProject({ groupBy })] }))
      expect(result.ok, `groupBy=${groupBy}`).toBe(false)
    }
  })

  // defaultProjectGroupBy
  it('accepts defaultProjectGroupBy with every valid ProjectGroupBy value plus empty', () => {
    const valid = ['', 'status', 'people', 'org', 'tag', 'scheduled', 'deadline', 'date']
    for (const value of valid) {
      const result = validateImportData(validData({
        settings: [{ key: 'defaultProjectGroupBy', value }],
      }))
      expect(result.ok).toBe(true)
    }
  })

  it('rejects defaultProjectGroupBy with unknown values', () => {
    const bad = ['none', 'priority', 'NaN', 'TAG', 'random-string']
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

  // horizonSlots — post-P6 array shape AND legacy map shape both validate
  it('accepts horizonSlots in the new ordered-array shape', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'horizonSlots', value: JSON.stringify([1, 2, 3, 4, 5]) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('accepts horizonSlots in the legacy map shape (pre-P6 backups)', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'horizonSlots', value: JSON.stringify({ thisweek: 1, someday: 5 }) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects horizonSlots with unknown key, non-integer value, or non-JSON', () => {
    const bad = [
      JSON.stringify({ bogus: 1 }),
      JSON.stringify({ thisweek: 'not-a-number' }),
      JSON.stringify({ thisweek: 1.5 }),
      JSON.stringify([1, 'two', 3]),
      JSON.stringify([1, 2.5, 3]),
      'not-json',
    ]
    for (const value of bad) {
      const result = validateImportData(validData({
        settings: [{ key: 'horizonSlots', value }],
      }))
      expect(result.ok).toBe(false)
    }
  })

  // horizonCollapsed
  it('accepts horizonCollapsed with boolean values', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'horizonCollapsed', value: JSON.stringify({ thisweek: true, later: false }) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects horizonCollapsed with non-boolean or oversized payload', () => {
    const oversized: Record<string, boolean> = {}
    for (let i = 0; i < 20; i++) oversized[`k${i}`] = true
    const bad = [
      JSON.stringify({ thisweek: 1 }),                  // non-boolean
      JSON.stringify({ unknown: true }),                // unknown key
      JSON.stringify(oversized),                        // too many entries
      JSON.stringify([true, false]),                    // array
    ]
    for (const value of bad) {
      const result = validateImportData(validData({
        settings: [{ key: 'horizonCollapsed', value }],
      }))
      expect(result.ok).toBe(false)
    }
  })

  // selectedHorizon (legacy) — accepted for backup compat
  it('accepts legacy selectedHorizon when its value is a valid HorizonKey', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'selectedHorizon', value: 'thisweek' }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects legacy selectedHorizon when the value is not a known HorizonKey', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'selectedHorizon', value: 'never' }],
    }))
    expect(result.ok).toBe(false)
  })

  // selectedHorizonDefId — post-P6 numeric / null id
  it('accepts selectedHorizonDefId with a numeric id', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'selectedHorizonDefId', value: '42' }],
    }))
    expect(result.ok).toBe(true)
  })

  it('accepts selectedHorizonDefId with empty string (null sentinel)', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'selectedHorizonDefId', value: '' }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects selectedHorizonDefId when the value is not numeric', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'selectedHorizonDefId', value: 'thisweek' }],
    }))
    expect(result.ok).toBe(false)
  })

  // maxTags accepted as a known setting key (P1 of code-review-2026-04-25)
  it('accepts maxTags setting key', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'maxTags', value: '20' }],
    }))
    expect(result.ok).toBe(true)
  })

  // canvasRails
  it('accepts structurally valid canvasRails', () => {
    const rails = {
      left: { orientation: 'vertical', slots: [{ id: 'a', kind: 'lens' }] },
      right: null,
      top: null,
      bottom: null,
    }
    const result = validateImportData(validData({
      settings: [{ key: 'canvasRails', value: JSON.stringify(rails) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects canvasRails with an invalid slot kind', () => {
    const rails = {
      left: { orientation: 'vertical', slots: [{ id: 'a', kind: 'evil' }] },
      right: null,
      top: null,
      bottom: null,
    }
    const result = validateImportData(validData({
      settings: [{ key: 'canvasRails', value: JSON.stringify(rails) }],
    }))
    expect(result.ok).toBe(false)
  })

  // Backward compat
  it('migrates groupId to projectId on todos', () => {
    const result = validateImportData({
      canvases: [makeCanvas()],
      todos: [(() => { const t = makeTodo(); delete (t as Record<string, unknown>).projectId; return { ...t, groupId: 5 } })()],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.todos[0]!.projectId).toBe(5)
    }
  })

  it('accepts "groups" as alias for "projects"', () => {
    const result = validateImportData({
      canvases: [makeCanvas()],
      groups: [makeProject()],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.projects).toHaveLength(1)
    }
  })

  // Size limits
  it('rejects title exceeding 500 chars', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ title: 'x'.repeat(501) })] }))
    expect(result.ok).toBe(false)
  })

  it('rejects NaN sortOrder', () => {
    const result = validateImportData(validData({ todos: [makeTodo({ sortOrder: NaN })] }))
    expect(result.ok).toBe(false)
  })

  // --- Org / TodoOrg / RecurrenceRule validation (Phases 6-7) ---

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

  // --- ListInset attributeFilter validation ---

  it('listInset with only attributeFilter and no preset passes validation', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Org List', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
          attributeFilter: { type: 'org', orgId: 1, orgName: 'Acme', orgColor: '#ff0000' } },
      ],
    }))
    expect(result.ok).toBe(true)
  })

  it('listInset with neither preset nor attributeFilter fails validation', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Empty Inset', canvasId: 1, x: 0, y: 0, width: 280, height: 300, isCollapsed: false },
      ],
    }))
    expect(result.ok).toBe(false)
  })

  it('listInset with invalid attributeFilter type fails validation', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Bad Filter', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
          attributeFilter: { type: 'unknown', someId: 1 } },
      ],
    }))
    expect(result.ok).toBe(false)
  })

  // --- Phase 2: Security hardening (M3/M4/M5) ---

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

  it('listInset attributeFilter with invalid tagColor fails', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Bad Color', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
          attributeFilter: { type: 'tag', tagId: 1, tagName: 'urgent', tagColor: 'not-a-color' } },
      ],
    }))
    expect(result.ok).toBe(false)
  })

  it('listInset attributeFilter with invalid orgColor fails', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Bad Color', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
          attributeFilter: { type: 'org', orgId: 1, orgName: 'Acme', orgColor: 'javascript:alert(1)' } },
      ],
    }))
    expect(result.ok).toBe(false)
  })

  it('savedView with invalid dateRangeStart fails', () => {
    const result = validateImportData(validData({
      savedViews: [{
        id: 1, name: 'View', sortBy: 'priority', sortOrder: 0,
        filters: {
          showCompleted: false, showAssigned: false, starredOnly: false,
          hardDeadlineOnly: false, dateRangeIncludeNoDue: false,
          dateRangeStart: 'not-a-date',
        },
      }],
    }))
    expect(result.ok).toBe(false)
  })

  it('savedView with valid date range passes', () => {
    const result = validateImportData(validData({
      savedViews: [{
        id: 1, name: 'View', sortBy: 'priority', sortOrder: 0,
        filters: {
          showCompleted: false, showAssigned: false, starredOnly: false,
          hardDeadlineOnly: false, dateRangeIncludeNoDue: false,
          dateRangeStart: '2026-01-01', dateRangeEnd: '2026-12-31',
        },
      }],
    }))
    expect(result.ok).toBe(true)
  })

  it('savedView with null date range fields passes', () => {
    const result = validateImportData(validData({
      savedViews: [{
        id: 1, name: 'View', sortBy: 'priority', sortOrder: 0,
        filters: {
          showCompleted: false, showAssigned: false, starredOnly: false,
          hardDeadlineOnly: false, dateRangeIncludeNoDue: false,
          dateRangeStart: null, dateRangeEnd: null,
        },
      }],
    }))
    expect(result.ok).toBe(true)
  })

  it('listInset with both preset and attributeFilter passes validation', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Dual Inset', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
          preset: 'due-this-week',
          attributeFilter: { type: 'tag', tagId: 2, tagName: 'urgent', tagColor: '#ff0000' } },
      ],
    }))
    expect(result.ok).toBe(true)
  })

  it('legacy starred list insets pass validation but are stripped from result', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Starred', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false, preset: 'starred' },
        { id: 2, name: 'Due', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false, preset: 'due-this-week' },
      ],
    }))
    expect(result.ok).toBe(true)
    expect(result.ok && result.data.listInsets).toHaveLength(1)
    expect(result.ok && result.data.listInsets[0]!.preset).toBe('due-this-week')
  })

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

  it('listDefinition with scheduled-asc sort kind passes validation', () => {
    const result = validateImportData(validData({
      listDefinitions: [{
        id: 1, name: 'Scheduled', sortOrder: 0, pinnedToDashboard: true,
        membership: {
          kind: 'custom',
          predicate: {
            showCompleted: false, showHiddenStatuses: false,
            searchText: '', dateRangeIncludeNoDate: false,
          },
        },
        sort: { kind: 'scheduled-asc' },
        grouping: { kind: 'none' },
      }],
    }))
    expect(result.ok).toBe(true)
  })
})
