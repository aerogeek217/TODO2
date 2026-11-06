import { settingsRepository } from '../data'
import { SETTING_KEYS } from '../data/setting-keys'
import { formatLensesSetting, isLensId } from '../data/lens-shape'
import { emptyPredicate, type TodoPredicate } from '../models/filter-predicate'
import { cleanLensName, findLens, lensPredicate, newLensId, presetLenses, uniqueLensName, type Lens } from '../utils/lens'
import { SETTINGS, useSettingsStore } from './settings-store'
import { trackWrite } from './store-helpers'

/**
 * The lenses' writes (D15; cr31 A5 moved them out of `settings-store`,
 * which keeps their state — `lenses`, `lensPresetsSeeded`, `activeLensId` —
 * loads it with the other settings rows and resets it on a data replace).
 * Both go through their settings' writers (`settings-store.SETTINGS`): every
 * lens edit is one undo step with the snackbar, named for the edit; the top
 * bar's pick saves at once with no undo step.
 */

/** The lenses as kept: completed tasks off; a lens without a usable name, or with an id an earlier one has, dropped. */
function normalizeLenses(lenses: readonly Lens[]): Lens[] {
  const ids = new Set<string>()
  const out: Lens[] = []
  for (const lens of lenses) {
    const name = cleanLensName(lens.name)
    if (!name || ids.has(lens.id)) continue
    ids.add(lens.id)
    out.push({ id: lens.id, name, predicate: lensPredicate(lens.predicate) })
  }
  return out
}

const lenses = () => useSettingsStore.getState().lenses

export const lensActions = {
  /**
   * Shows and saves the lenses (normalised: completed tasks off; a lens
   * without a usable name, or with an id an earlier one has, dropped) as one
   * undo step named `description`, with the undo snackbar. Resolves whether
   * they are saved (a failed save adds no step, puts the lenses back and
   * says so; the same lenses again write nothing).
   */
  async setLenses(next: readonly Lens[], description: string): Promise<boolean> {
    const kept = normalizeLenses(next)
    if (formatLensesSetting(lenses()) === formatLensesSetting(kept)) return true
    return SETTINGS.lenses.write({ lenses: kept }, { description })
  },

  /**
   * Adds a lens named `name` (made unique) keeping `predicate` (default:
   * every task) after the others; resolves its id, or null (a blank name, a
   * failed save).
   */
  async addLens(name: string, predicate?: TodoPredicate): Promise<string | null> {
    const clean = cleanLensName(name)
    if (!clean) return null
    const all = lenses()
    const lens: Lens = { id: newLensId(all), name: uniqueLensName(all, clean), predicate: lensPredicate(predicate ?? emptyPredicate()) }
    return (await lensActions.setLenses([...all, lens], `New lens “${lens.name}”`)) ? lens.id : null
  },

  /** Renames a lens; a blank name or an unknown id changes nothing (false). */
  async renameLens(id: string, name: string): Promise<boolean> {
    const clean = cleanLensName(name)
    const lens = findLens(lenses(), id)
    if (!clean || !lens) return false
    if (clean === lens.name) return true
    return lensActions.setLenses(
      lenses().map((l) => (l.id === id ? { ...l, name: clean } : l)),
      `Renamed lens “${lens.name}” to “${clean}”`,
    )
  },

  /**
   * What a lens keeps, as one undo step (`Changed lens “<name>”`); resolves
   * whether it is saved (the same filter: true, nothing written; an unknown
   * id: false).
   */
  async setLensPredicate(id: string, predicate: TodoPredicate): Promise<boolean> {
    const lens = findLens(lenses(), id)
    if (!lens) return false
    return lensActions.setLenses(
      lenses().map((l) => (l.id === id ? { ...l, predicate } : l)),
      `Changed lens “${lens.name}”`,
    )
  },

  /** Copies a lens right after it (`<name> 2`); resolves the copy's id, or null. */
  async duplicateLens(id: string): Promise<string | null> {
    const all = lenses()
    const at = all.findIndex((l) => l.id === id)
    const lens = all[at]
    if (!lens) return null
    const copy: Lens = { id: newLensId(all), name: uniqueLensName(all, lens.name), predicate: lens.predicate }
    const next = [...all.slice(0, at + 1), copy, ...all.slice(at + 1)]
    return (await lensActions.setLenses(next, `Duplicated lens “${lens.name}”`)) ? copy.id : null
  },

  /**
   * Moves the lens at `fromIndex` to `toIndex` (Settings' order — the top
   * bar picker's, the phone sheet's and Cycle lens's) as one undo step
   * (`Moved lens “<name>”`), saved at once. An index out of range changes
   * nothing (false); the same place again: true.
   */
  async moveLens(fromIndex: number, toIndex: number): Promise<boolean> {
    const next = [...lenses()]
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= next.length) return false
    const [lens] = fromIndex >= 0 ? next.splice(fromIndex, 1) : []
    if (!lens) return false
    if (fromIndex === toIndex) return true
    next.splice(toIndex, 0, lens)
    return lensActions.setLenses(next, `Moved lens “${lens.name}”`)
  },

  /**
   * Seeds the preset lenses once (`utils/lens.presetLenses`; Not waiting
   * only with `waitingId`) after any lenses there are, and records that it
   * did, both rows in one transaction — no undo step. Does nothing once
   * seeded.
   */
  seedLensPresets(waitingId: number | null): Promise<void> {
    return trackWrite(async () => {
      const store = useSettingsStore
      if (store.getState().lensPresetsSeeded) return
      const all = lenses()
      const ids: Lens[] = [...all]
      const presets = presetLenses(waitingId, () => {
        const id = newLensId(ids)
        ids.push({ id, name: '', predicate: emptyPredicate() })
        return id
      })
      const next = [...all, ...presets.map((p) => ({ ...p, name: uniqueLensName(all, p.name) }))]
      store.setState({ lenses: next, lensPresetsSeeded: true })
      try {
        await settingsRepository.writeMany({
          [SETTING_KEYS.lenses]: formatLensesSetting(next),
          [SETTING_KEYS.lensPresetsSeeded]: 'true',
        })
      } catch (e) {
        // Kept on screen for this session; the next open of Settings › Lenses tries again.
        console.error('Failed to seed the preset lenses:', e)
        store.setState({ lensPresetsSeeded: false })
      }
    })
  },

  /**
   * Picks the top bar's lens (`null` = No lens: the row goes): shown at
   * once and saved — no unsaved state and no undo step, like a layout
   * switch. A failed save puts the pick back and says so. Resolves whether
   * the pick is saved (the same pick again: true; anything but a lens id's
   * shape is ignored: false).
   */
  async setActiveLens(id: string | null): Promise<boolean> {
    if (id !== null && !isLensId(id)) return false
    return SETTINGS.activeLensId.write({ activeLensId: id })
  },
}
