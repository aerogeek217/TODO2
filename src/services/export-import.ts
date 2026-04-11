import { db } from '../data/database'

/**
 * Reads all database tables and returns a plain object suitable for
 * JSON serialization (export, file-storage save, or backup snapshot).
 */
export async function buildExportData() {
  const [todos, projects, canvases, listInsets, people, settings, tags, todoTags, todoPeople, todoOrgs, personOrgs, orgs, savedViews, stickyNotes] =
    await Promise.all([
      db.todos.toArray(), db.projects.toArray(), db.canvases.toArray(), db.listInsets.toArray(),
      db.people.toArray(), db.settings.toArray(), db.tags.toArray(), db.todoTags.toArray(),
      db.todoPeople.toArray(), db.todoOrgs.toArray(), db.personOrgs.toArray(), db.orgs.toArray(),
      db.savedViews.toArray(), db.stickyNotes.toArray(),
    ])

  return { todos, projects, canvases, listInsets, people, settings, tags, todoTags, todoPeople, todoOrgs, personOrgs, orgs, savedViews, stickyNotes }
}
