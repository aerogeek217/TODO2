import { describe, it, expect } from 'vitest'
import { validateImportData, isValidCssColor } from '../../data/import-validation'
import { Priority } from '../../models/priority'

const now = new Date().toISOString()

function makeCanvas(overrides = {}) {
  return { id: 1, name: 'Canvas', sortOrder: 0, createdAt: now, ...overrides }
}

function makeTodo(overrides = {}) {
  return {
    id: 1, title: 'Task', priority: Priority.Normal,
    isCompleted: false, isStarred: false,
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

  // Backward compat
  it('migrates groupId to projectId on todos', () => {
    const result = validateImportData({
      canvases: [makeCanvas()],
      todos: [(() => { const t = makeTodo(); delete (t as Record<string, unknown>).projectId; return { ...t, groupId: 5 } })()],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.todos[0].projectId).toBe(5)
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

  it('listInset with both preset and attributeFilter passes validation', () => {
    const result = validateImportData(validData({
      listInsets: [
        { id: 1, name: 'Dual Inset', canvasId: 1, x: 0, y: 0, width: 320, height: 300, isCollapsed: false,
          preset: 'starred',
          attributeFilter: { type: 'tag', tagId: 2, tagName: 'urgent', tagColor: '#ff0000' } },
      ],
    }))
    expect(result.ok).toBe(true)
  })
})
