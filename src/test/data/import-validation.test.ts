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

  // defaultProjectGroupBy — accepts every flat TodoGroupBy literal plus the
  // empty string sentinel.
  it('accepts defaultProjectGroupBy with every valid TodoGroupBy value plus empty', () => {
    const valid = ['', 'none', 'status', 'people', 'org', 'tag', 'scheduled', 'deadline', 'date']
    for (const value of valid) {
      const result = validateImportData(validData({
        settings: [{ key: 'defaultProjectGroupBy', value }],
      }))
      expect(result.ok).toBe(true)
    }
  })

  it('rejects defaultProjectGroupBy with unknown values', () => {
    const bad = ['priority', 'NaN', 'TAG', 'random-string']
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

  // horizonSlots — ordered-array shape only (legacy map shape removed in P4).
  it('accepts horizonSlots in the ordered-array shape', () => {
    const result = validateImportData(validData({
      settings: [{ key: 'horizonSlots', value: JSON.stringify([1, 2, 3, 4, 5]) }],
    }))
    expect(result.ok).toBe(true)
  })

  it('rejects horizonSlots with non-integer entries or non-array', () => {
    const bad = [
      JSON.stringify({ thisweek: 1 }),       // legacy map shape no longer accepted
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

  // selectedHorizonDefId — numeric or empty-string sentinel.
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

  it('listDefinition with scheduled sort + none grouping passes validation', () => {
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
        sort: 'scheduled',
        grouping: 'none',
      }],
    }))
    expect(result.ok).toBe(true)
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
