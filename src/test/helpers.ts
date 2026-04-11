import { Priority } from '../models'
import type { PersistedTodoItem, Person, Tag, Project, Org } from '../models'
import { db } from '../data/database'

export function makeTodo(overrides: Partial<PersistedTodoItem> & { id: number }): PersistedTodoItem {
  return {
    title: `Task ${overrides.id}`,
    priority: Priority.Normal,
    isCompleted: false,
    isStarred: false,
    createdAt: new Date(),
    modifiedAt: new Date(),
    sortOrder: overrides.id,
    ...overrides,
  }
}

export function makePerson(overrides: Partial<Person> & { id: number }): Person & { id: number } {
  return {
    name: `Person ${overrides.id}`,
    initials: `P${overrides.id}`,
    color: '#537FE7',
    ...overrides,
  }
}

export function makeTag(overrides: Partial<Tag> & { id: number }): Tag & { id: number } {
  return {
    name: `Tag ${overrides.id}`,
    color: '#FF5733',
    ...overrides,
  }
}

export function makeProject(overrides: Partial<Project> & { id: number; canvasId: number }): Project & { id: number } {
  return {
    name: `Project ${overrides.id}`,
    positionX: 0,
    positionY: 0,
    isCollapsed: false,
    sortOrder: overrides.id,
    createdAt: new Date(),
    ...overrides,
  }
}

export function makeOrg(overrides: Partial<Org> & { id: number }): Org & { id: number } {
  return {
    name: `Org ${overrides.id}`,
    ...overrides,
  }
}

export async function resetDb(): Promise<void> {
  await db.delete()
  await db.open()
}
