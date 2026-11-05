import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CURRENT_DB_VERSION, db, findDatabaseTooNew, onDatabaseChangedElsewhere, type DatabaseChangeElsewhere } from '../../data/database'
import { DatabaseChangedElsewhereGuard } from '../../components/overlays/DatabaseVersionDialog'

/**
 * Another tab upgrades (a newer build) or deletes the database while this
 * tab has it open (cr31 data L3): Dexie closes this tab's connection so the
 * other can go on, every later write here fails, and the page is blocked
 * with a Reload instead of losing what is typed one write at a time.
 */

/** Another tab's newer build opening the database at `version`: waits for this tab to let go. */
function openElsewhereAt(version: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('todo2', version * 10)
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

function deleteElsewhere(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase('todo2')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

afterEach(async () => {
  cleanup()
  db.close()
  await db.delete()
  await db.open()
})

describe('the database changed in another tab', () => {
  it('an upgrade elsewhere closes this tab’s connection and says so; later writes fail', async () => {
    await db.open()
    const seen: DatabaseChangeElsewhere[] = []
    const off = onDatabaseChangedElsewhere((c) => seen.push(c))
    await openElsewhereAt(CURRENT_DB_VERSION + 1)
    off()
    expect(seen).toEqual(['upgraded'])
    expect(db.isOpen()).toBe(false)
    const write = await db.settings.put({ key: 'themeMode', value: 'light' }).then(() => null, (e: unknown) => e)
    expect(findDatabaseTooNew(write)).not.toBeNull()
  })

  it('a delete elsewhere says so too', async () => {
    await db.open()
    const seen: DatabaseChangeElsewhere[] = []
    const off = onDatabaseChangedElsewhere((c) => seen.push(c))
    await deleteElsewhere()
    off()
    expect(seen).toEqual(['deleted'])
  })

  it('the guard blocks the page with Reload as the only way on', async () => {
    await db.open()
    render(<DatabaseChangedElsewhereGuard />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await openElsewhereAt(CURRENT_DB_VERSION + 1)
    const dialog = await screen.findByRole('dialog', { name: 'TODO2 changed in another tab' })
    expect(dialog.textContent).toContain('A newer version of TODO2 opened this browser’s data in another tab or window.')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Reload'])
  })
})
