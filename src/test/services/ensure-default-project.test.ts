import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../../data/database'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { ensureDefaultProject } from '../../services/ensure-default-project'
import { DEFAULT_CANVAS_MAX_EXTENT } from '../../utils/canvas-bounds'

let canvasId: number

beforeEach(async () => {
  await db.delete()
  await db.open()
  canvasId = (await db.canvases.add({ name: 'Canvas', sortOrder: 1, createdAt: new Date() })) as number
  useProjectStore.setState({ projects: [], loading: false, error: null })
  useSettingsStore.setState({
    defaultProjectId: null,
    defaultProjectGroupBy: 'tag',
    canvasMaxExtent: DEFAULT_CANVAS_MAX_EXTENT,
  })
})

describe('ensureDefaultProject', () => {
  it('creates an Inbox project on a canvas with no projects and persists defaultProjectId', async () => {
    const id = await ensureDefaultProject(canvasId)
    const projects = useProjectStore.getState().projects
    expect(projects).toHaveLength(1)
    const inbox = projects[0]!
    expect(inbox.id).toBe(id)
    expect(inbox.name).toBe('Inbox')
    expect(inbox.canvasId).toBe(canvasId)
    expect(inbox.positionX).toBe(0)
    expect(inbox.positionY).toBe(0)
    expect(inbox.groupBy).toBe('tag')
    expect(useSettingsStore.getState().defaultProjectId).toBe(id)
  })

  it('returns the first existing project on the canvas without creating an Inbox', async () => {
    const existingId = await useProjectStore.getState().add('Existing', canvasId)
    const projectsBefore = useProjectStore.getState().projects.length
    const id = await ensureDefaultProject(canvasId)
    expect(id).toBe(existingId)
    expect(useProjectStore.getState().projects).toHaveLength(projectsBefore)
    // Existing-project path does not persist defaultProjectId.
    expect(useSettingsStore.getState().defaultProjectId).toBeNull()
  })

  it('seeds Inbox with defaultProjectGroupBy=null when set', async () => {
    useSettingsStore.setState({ defaultProjectGroupBy: null })
    const id = await ensureDefaultProject(canvasId)
    const inbox = useProjectStore.getState().projects.find((p) => p.id === id)!
    expect(inbox.groupBy ?? null).toBeNull()
  })

  it('only inspects projects on the requested canvas', async () => {
    const otherCanvasId = (await db.canvases.add({ name: 'Other', sortOrder: 2, createdAt: new Date() })) as number
    await useProjectStore.getState().add('Elsewhere', otherCanvasId)
    // Reload all projects so the store sees both canvases.
    await useProjectStore.getState().loadAll()
    const id = await ensureDefaultProject(canvasId)
    const inbox = useProjectStore.getState().projects.find((p) => p.id === id)!
    expect(inbox.name).toBe('Inbox')
    expect(inbox.canvasId).toBe(canvasId)
  })
})
