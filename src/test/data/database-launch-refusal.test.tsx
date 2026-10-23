import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import App from '../../App'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'

/**
 * The backstop behind the version check: when the check before launch finds
 * nothing to refuse (it couldn't read the version), the launch's own open of
 * a database below the floor or saved by a newer build still refuses it, and
 * the app says so instead of starting with empty stores.
 */

vi.mock('../../services/migration-check', () => ({
  checkTooOldDB: () => Promise.resolve(null),
  checkTooNewDB: () => Promise.resolve(null),
}))

/** Opens the raw `todo2` database at `nativeVersion`, adding a `todos` store when it has none. */
function createRawDb(nativeVersion: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', nativeVersion)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('todos')) req.result.createObjectStore('todos', { keyPath: 'id', autoIncrement: true })
    }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

function rawVersion(): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => { const v = req.result.version; req.result.close(); resolve(v) }
    req.onerror = () => reject(req.error)
  })
}

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
})

describe('the launch’s open, when the version check found nothing', () => {
  it('refuses a database below the floor, untouched', async () => {
    await createRawDb((OLDEST_SUPPORTED_DB_VERSION - 1) * 10)
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Data from an older version of TODO2' })
    expect(dialog.textContent).toContain(`this version reads v${OLDEST_SUPPORTED_DB_VERSION} and newer`)
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(await rawVersion()).toBe((OLDEST_SUPPORTED_DB_VERSION - 1) * 10)
  })

  it('refuses a database a newer build saved', async () => {
    await db.open()
    db.close()
    await createRawDb((CURRENT_DB_VERSION + 1) * 10)
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Data from a newer version of TODO2' })
    expect(dialog.textContent).toContain(`(schema v${CURRENT_DB_VERSION + 1})`)
    expect(await rawVersion()).toBe((CURRENT_DB_VERSION + 1) * 10)
  })
})
