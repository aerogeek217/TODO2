import { describe, it, expect, beforeEach } from 'vitest'
import { createTasksFromDrafts } from '../../services/note-tasks'
import { draftFromText } from '../../services/task-draft'
import { useSettingsStore } from '../../stores/settings-store'
import { useTagStore } from '../../stores/tag-store'
import { useUndoStore } from '../../stores/undo-store'
import { resetDb } from '../helpers'

// A note's lines converted together end with the "Created N tasks" snackbar
// (with Undo). A tag the limit refused must still be said there — before,
// the batch's snackbar replaced the tag-limit notice.

beforeEach(async () => {
  await resetDb()
  useSettingsStore.setState({ maxTags: 1 })
  await useTagStore.getState().add('existing')
})

describe('notes → tasks with the tag limit reached', () => {
  it('the batch snackbar says the tags were not added, and keeps its Undo', async () => {
    const ctx = { people: [], statuses: [], tags: useTagStore.getState().tags, today: new Date() }
    const drafts = [draftFromText('First #brandnew', ctx), draftFromText('Second', ctx)]
    const created = await createTasksFromDrafts(drafts, { description: 'Created 2 tasks', snackbar: true })
    expect(created).toHaveLength(2)
    const snackbar = useUndoStore.getState().snackbar
    expect(snackbar?.notice).toBeUndefined()
    expect(snackbar?.description).toBe('Created 2 tasks. Tag limit reached (1) — delete unused tags in Settings → People, statuses & tags.')
  })

  it('a single create (no batch snackbar) still gets the notice on its own', async () => {
    const ctx = { people: [], statuses: [], tags: useTagStore.getState().tags, today: new Date() }
    await createTasksFromDrafts([draftFromText('Only #brandnew', ctx)], { description: 'Add "Only"' })
    expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: expect.stringContaining('Tag limit reached (1)') as unknown })
  })
})
