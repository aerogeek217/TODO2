import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v60 — projects become tags; the canvas and its floating widgets go.
 *
 * - Each project becomes a tag named `Project: <name>` in the project's
 *   color (or `V60_DEFAULT_TAG_COLOR` when it has none). A tag with that
 *   name already present (case-insensitive) is reused, so two projects with
 *   the same name share one tag. Every task in a project gets that tag
 *   (`todoTags`; pairs the task already has are skipped).
 * - `projectId` / `canvasId` are removed from tasks. A `projectId` whose
 *   project row isn't in the dataset (a deleted project, or a task archive
 *   written without it) is dropped without a tag.
 * - Stored list definitions (see `rewritePredicate`): the project filter
 *   folds into the tag filter; grouping by project → by tag; sorting by
 *   project → manual; a prompt on projects → a prompt on tags.
 * - Tables dropped: `projects`, `canvases`, `listInsets` and the floating
 *   widget placements (`floatingCalendars`, `floatingNotes`,
 *   `floatingStatus`). Placement only: list definitions, the note and the
 *   tasks live in their own tables. (v56 already copied the rails and floats
 *   into the workspace's "Default" layout.)
 * - Settings removed: `V60_REMOVED_SETTING_KEYS`.
 *
 * Frozen with this transform: the name prefix, the fallback color, and the
 * removed tables / setting keys / enum values below.
 *
 * Idempotent (data without projects, project fields or removed values passes
 * through unchanged); tolerates missing tables — a task archive carries
 * `projects` with its tasks, so archived project membership arrives as tags.
 */

/** Name prefix of a tag created from a project. */
export const V60_PROJECT_TAG_PREFIX = 'Project: '

/** Color of a tag created from a project that had no color. */
export const V60_DEFAULT_TAG_COLOR = '#537FE7'

/** Tables v60 drops (the Dexie block declares them `null`). */
export const V60_DROPPED_TABLES = [
  'projects', 'canvases', 'listInsets', 'floatingCalendars', 'floatingNotes', 'floatingStatus',
] as const

/** Setting keys v60 removes. */
export const V60_REMOVED_SETTING_KEYS = [
  'defaultProjectId', 'defaultProjectGroupBy', 'canvasViewport', 'canvasMaxExtent', 'canvasRails',
] as const

const TAG_NAME_MAX = 200
const PROJECT_AXIS = 'project'

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isId(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

function maxId(rows: readonly unknown[] | undefined): number {
  let max = 0
  for (const row of rows ?? []) if (isRecord(row) && isId(row.id) && row.id > max) max = row.id
  return max
}

interface TagsResult {
  tags: DataRow[] | undefined
  /** project id → tag id */
  projectToTag: Map<number, number>
}

/** Tags after adding one `Project: <name>` tag per project (see the module comment). */
function projectTags(tagsIn: DataRow[] | undefined, projects: DataRow[] | undefined): TagsResult {
  const projectToTag = new Map<number, number>()
  const rows = (projects ?? []).filter((p) => isRecord(p) && isId(p.id) && typeof p.name === 'string')
  if (rows.length === 0) return { tags: tagsIn, projectToTag }

  const tags: DataRow[] = [...(tagsIn ?? [])]
  const byName = new Map<string, number>()
  for (const tag of tags) {
    if (isRecord(tag) && isId(tag.id) && typeof tag.name === 'string' && !byName.has(nameKey(tag.name))) {
      byName.set(nameKey(tag.name), tag.id)
    }
  }
  let nextId = maxId(tagsIn) + 1
  let added = false
  for (const project of rows) {
    const name = (V60_PROJECT_TAG_PREFIX + (project.name as string).trim()).slice(0, TAG_NAME_MAX)
    const existing = byName.get(nameKey(name))
    if (existing !== undefined) {
      projectToTag.set(project.id as number, existing)
      continue
    }
    const color = typeof project.color === 'string' && project.color.trim() !== '' ? project.color : V60_DEFAULT_TAG_COLOR
    const id = nextId++
    tags.push({ id, name, color })
    byName.set(nameKey(name), id)
    projectToTag.set(project.id as number, id)
    added = true
  }
  return { tags: added ? tags : tagsIn, projectToTag }
}

/** `todoTags` plus one row per task in a project (skipping pairs already present). */
function projectAssignments(
  todoTagsIn: DataRow[] | undefined,
  todos: DataRow[] | undefined,
  projectToTag: ReadonlyMap<number, number>,
): DataRow[] | undefined {
  if (!Array.isArray(todos) || projectToTag.size === 0) return todoTagsIn
  const seen = new Set<string>()
  for (const row of todoTagsIn ?? []) {
    if (isRecord(row) && isId(row.todoId) && isId(row.tagId)) seen.add(`${row.todoId}:${row.tagId}`)
  }
  const out = [...(todoTagsIn ?? [])]
  let nextId = maxId(todoTagsIn) + 1
  for (const todo of todos) {
    if (!isRecord(todo) || !isId(todo.id) || !isId(todo.projectId)) continue
    const tagId = projectToTag.get(todo.projectId)
    if (tagId === undefined) continue
    const key = `${todo.id}:${tagId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: nextId++, todoId: todo.id, tagId })
  }
  return out.length === (todoTagsIn ?? []).length ? todoTagsIn : out
}

function stripTodoFields(todos: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(todos)) return todos
  let changed = false
  const out = todos.map((row) => {
    if (!isRecord(row) || (!('projectId' in row) && !('canvasId' in row))) return row
    changed = true
    const next: DataRow = { ...row }
    delete next.projectId
    delete next.canvasId
    return next
  })
  return changed ? out : todos
}

/**
 * Stored predicate: the project filter folds into the tag filter. Both used
 * to AND together; there is one filter now, so the projects' tags join the
 * tag side (union — the tag filter ORs its ids):
 *
 * - tag `null` + project `null` → `null` (no filter)
 * - one side `null` → the other side (project ids mapped to their tags)
 * - both arrays → union; either side `[]` → `[]` (an empty filter matched
 *   nothing and still does)
 *
 * Ids of projects that no longer exist are dropped (they matched no task).
 * The "no project" sentinel `0` has no tag equivalent (the tag filter has no
 * "untagged" option) and is dropped too; when it leaves the project side
 * empty (e.g. `[0]`, "tasks without a project") the list gets no project
 * filter at all. Lists that lose the sentinel are reported (console warning).
 */
function rewritePredicate(p: unknown, projectToTag: ReadonlyMap<number, number>): { predicate: unknown; droppedNoProject: boolean } {
  if (!isRecord(p) || !('projectIds' in p)) return { predicate: p, droppedNoProject: false }
  const next: Obj = { ...p }
  delete next.projectIds
  const raw = p.projectIds
  if (!Array.isArray(raw)) return { predicate: next, droppedNoProject: false }
  const droppedNoProject = raw.includes(0)
  const projectSide: number[] = []
  for (const id of raw) {
    if (!isId(id) || id === 0) continue
    const tagId = projectToTag.get(id)
    if (tagId !== undefined && !projectSide.includes(tagId)) projectSide.push(tagId)
  }
  // Only "no project" picked (plus maybe deleted projects): no project filter.
  if (projectSide.length === 0 && droppedNoProject) return { predicate: next, droppedNoProject }
  const tagSide = p.tags
  if (tagSide === null || tagSide === undefined) {
    next.tags = projectSide
  } else if (Array.isArray(tagSide)) {
    next.tags = tagSide.length === 0 || projectSide.length === 0
      ? []
      : [...tagSide, ...projectSide.filter((id) => !tagSide.includes(id))]
  }
  return { predicate: next, droppedNoProject }
}

function upgradeListDefinitions(rows: DataRow[] | undefined, projectToTag: ReadonlyMap<number, number>): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const noProjectLists: string[] = []
  let changed = false
  const out = rows.map((row) => {
    if (!isRecord(row)) return row
    const next: DataRow = { ...row }
    let rowChanged = false
    if (row.grouping === PROJECT_AXIS) { next.grouping = 'tag'; rowChanged = true }
    if (row.sort === PROJECT_AXIS) { next.sort = 'manual'; rowChanged = true }
    const membership = row.membership
    if (isRecord(membership) && 'predicate' in membership) {
      const { predicate, droppedNoProject } = rewritePredicate(membership.predicate, projectToTag)
      if (predicate !== membership.predicate) { next.membership = { ...membership, predicate }; rowChanged = true }
      if (droppedNoProject) noProjectLists.push(typeof row.name === 'string' ? row.name : String(row.id))
    }
    const rf = row.runtimeFilter
    if (isRecord(rf) && rf.field === PROJECT_AXIS) { next.runtimeFilter = { ...rf, field: 'tag' }; rowChanged = true }
    if (!rowChanged) return row
    changed = true
    return next
  })
  if (noProjectLists.length > 0) {
    console.warn(`[upgrade v60] "No project" filter dropped (no tag equivalent) from: ${noProjectLists.join(', ')}`)
  }
  return changed ? out : rows
}

function upgradeSettings(rows: DataRow[] | undefined): DataRow[] | undefined {
  if (!Array.isArray(rows)) return rows
  const removed: ReadonlySet<string> = new Set(V60_REMOVED_SETTING_KEYS)
  const out = rows.filter((row) => !(isRecord(row) && typeof row.key === 'string' && removed.has(row.key)))
  return out.length === rows.length ? rows : out
}

/** v60 — projects → `Project: <name>` tags; drop the canvas tables, project / canvas fields and settings. */
export function upgradeV60(data: DataSet): DataSet {
  const out: DataSet = { ...data }
  for (const table of V60_DROPPED_TABLES) delete out[table]

  const { tags, projectToTag } = projectTags(data.tags, data.projects)
  if (tags !== undefined && tags !== data.tags) out.tags = tags
  const todoTags = projectAssignments(data.todoTags, data.todos, projectToTag)
  if (todoTags !== undefined && todoTags !== data.todoTags) out.todoTags = todoTags
  const todos = stripTodoFields(data.todos)
  if (todos !== undefined && todos !== data.todos) out.todos = todos

  const lists = upgradeListDefinitions(data.listDefinitions, projectToTag)
  if (lists !== undefined && lists !== data.listDefinitions) out.listDefinitions = lists
  const settings = upgradeSettings(data.settings)
  if (settings !== undefined && settings !== data.settings) out.settings = settings

  // Already v60-shaped: hand back the same object (idempotence).
  const changed = V60_DROPPED_TABLES.some((t) => t in data)
    || Object.keys(out).some((t) => out[t] !== data[t])
  return changed ? out : data
}
