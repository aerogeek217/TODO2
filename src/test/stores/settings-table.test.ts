import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/database'
import { settingsRepository } from '../../data'
import { SETTINGS, useSettingsStore } from '../../stores/settings-store'
import type { SettingRows, SettingSpec, SettingWriter } from '../../stores/setting-writes'
import { useUndoStore } from '../../stores/undo-store'
import { DEFAULT_THEMED_COLORS } from '../../models/theme-colors'
import { emptyPredicate } from '../../models/filter-predicate'
import { checkinFilterOf } from '../../utils/checkin-settings'
import { DEFAULT_PRIORITY_CUES } from '../../utils/priority-cues'
import { DEFAULT_AMBIENCE } from '../../models/ambience'

type State = ReturnType<typeof useSettingsStore.getState>
type Writable = SettingSpec<State, keyof State> & SettingWriter<State, keyof State>

interface Case {
  /** A value other than the default. */
  value: Partial<State>
  /** The undo step a change makes on its own (null: none — internal, or named by the caller). */
  undo: string | null
  /** The notice a failed save shows (null: only logged). */
  failure: string | null
}

// One row per setting the store writes: a new entry in `SETTINGS` needs one here.
const CASES: Record<string, Case> = {
  colors: {
    value: { colors: { dark: { ...DEFAULT_THEMED_COLORS.dark, accent: '#112233' }, light: { ...DEFAULT_THEMED_COLORS.light } }, customizedColors: { dark: ['accent'], light: [] } },
    undo: null,
    failure: 'Couldn’t save the theme colors.',
  },
  themeMode: { value: { themeMode: 'light' }, undo: null, failure: 'Couldn’t save the theme.' },
  defaultStatusId: { value: { defaultStatusId: 4 }, undo: 'Changed the default status', failure: 'Couldn’t save the default status.' },
  completedRetentionDays: { value: { completedRetentionDays: 30 }, undo: 'Offer to delete completed tasks after 30 days', failure: 'Couldn’t save when to offer to delete completed tasks.' },
  weekStartsOn: { value: { weekStartsOn: 0 }, undo: 'Weeks start on Sunday', failure: 'Couldn’t save the first day of the week.' },
  followupDefaultInterval: { value: { followupDefaultInterval: { count: 2, unit: 'w' } }, undo: 'Follow-up interval 2 weeks', failure: 'Couldn’t save the follow-up interval.' },
  autoFollowup: { value: { autoFollowup: false }, undo: 'Don’t set a next follow-up automatically', failure: 'Couldn’t save whether a next follow-up is set automatically.' },
  removeConvertedLines: { value: { removeConvertedLines: true }, undo: 'Remove note lines after converting', failure: 'Couldn’t save what converted note lines become.' },
  urgentDueWithinDays: { value: { urgentDueWithinDays: 7 }, undo: 'Due within 1 week makes a task urgent', failure: 'Couldn’t save when a due date makes a task urgent.' },
  checkinOpenMethod: { value: { checkinOpenMethod: 'eml' }, undo: null, failure: 'Couldn’t save how check-ins open.' },
  checkinTaskFilter: { value: { checkinTaskFilter: checkinFilterOf({ ...emptyPredicate(), tags: [4] }) }, undo: null, failure: 'Couldn’t save the check-in filter.' },
  newListSort: { value: { newListSort: 'deadline', newListSortDirection: 'desc' }, undo: 'New lists sort by Due date ↓', failure: 'Couldn’t save how new lists sort.' },
  newListGroup: { value: { newListGroup: 'people' }, undo: 'New lists group by People', failure: 'Couldn’t save how new lists group.' },
  purgePromptIntervalDays: { value: { purgePromptIntervalDays: 14 }, undo: 'Ask about old completed tasks at most every 14 days', failure: 'Couldn’t save how often to ask about old completed tasks.' },
  purgePromptLastAt: { value: { purgePromptLastAt: new Date('2026-10-20T08:15:00.000Z') }, undo: null, failure: null },
  staleAfterDays: { value: { staleAfterDays: 45 }, undo: 'Fade tasks untouched for 45 days', failure: 'Couldn’t save when to fade untouched tasks.' },
  tabBadges: { value: { tabBadges: { due: 7, followup: 'off' } }, undo: 'Changed the tab badges', failure: 'Couldn’t save the tab badges.' },
  priorityCues: { value: { priorityCues: { ...DEFAULT_PRIORITY_CUES, focus: { glow: true, semibold: false } } }, undo: 'Changed the priority cues', failure: 'Couldn’t save the priority cues.' },
  listZoom: { value: { listZoom: 'lines' }, undo: 'Default list zoom: Lines', failure: 'Couldn’t save the default list zoom.' },
  rowDates: { value: { rowDates: 'numeric' }, undo: 'MM/DD dates on rows', failure: 'Couldn’t save how rows show dates.' },
  ambience: { value: { ambience: { ...DEFAULT_AMBIENCE, sky: 'vivid' } }, undo: 'Ambience: Vivid, with seasons', failure: 'Couldn’t save the ambience settings.' },
  lenses: { value: { lenses: [{ id: 'lens-a', name: 'Fresh', predicate: emptyPredicate() }] }, undo: null, failure: 'Couldn’t save the lenses.' },
  activeLensId: { value: { activeLensId: 'lens-a' }, undo: null, failure: 'Couldn’t save the lens pick.' },
  shortcutOverrides: { value: { shortcutOverrides: { 'command-palette': [{ key: 'p', mod: true, shift: true }] } }, undo: null, failure: 'Couldn’t save the keyboard shortcuts.' },
}

const writable = Object.entries(SETTINGS).filter(([, s]) => 'write' in s) as unknown as [string, Writable][]
const fieldsOf = (spec: Writable, state: State) => Object.fromEntries(spec.fields.map((f) => [f, state[f]]))

async function expectStored(rows: SettingRows): Promise<void> {
  for (const [key, value] of Object.entries(rows)) {
    expect(await db.settings.get(key), key).toEqual(value === null ? undefined : { key, value })
  }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await useSettingsStore.getState().load()
  useUndoStore.getState().clear()
})

afterEach(() => { vi.restoreAllMocks() })

describe('the settings table', () => {
  it('has a case for every setting the store writes', () => {
    expect(writable.map(([name]) => name).sort()).toEqual(Object.keys(CASES).sort())
  })

  it('every setting reads no rows as the store’s initial value', () => {
    const initial = useSettingsStore.getInitialState()
    for (const s of Object.values(SETTINGS)) {
      expect(s.read(new Map())).toEqual(Object.fromEntries(s.fields.map((f) => [f, initial[f]])))
    }
  })

  describe.each(writable)('%s', (name, spec) => {
    const c = CASES[name]!

    it('shows and stores the value, and reads it back on load', async () => {
      expect(await spec.write(c.value as never)).toBe(true)
      expect(fieldsOf(spec, useSettingsStore.getState())).toEqual(c.value)
      await expectStored(spec.rows(c.value as never))
      useSettingsStore.setState(useSettingsStore.getInitialState())
      await useSettingsStore.getState().load()
      expect(fieldsOf(spec, useSettingsStore.getState())).toEqual(c.value)
    })

    it(c.undo ? `is one undo step (${c.undo}); its undo stores the value before` : 'adds no undo step of its own', async () => {
      const before = fieldsOf(spec, useSettingsStore.getState())
      await spec.write(c.value as never)
      expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(c.undo ? [c.undo] : [])
      if (!c.undo) return
      await useUndoStore.getState().undo()
      expect(fieldsOf(spec, useSettingsStore.getState())).toEqual(before)
      await expectStored(spec.rows(before as never))
    })

    it(c.failure ? 'a failed save puts the value back and says so' : 'a failed save puts the value back and is only logged', async () => {
      const before = fieldsOf(spec, useSettingsStore.getState())
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.spyOn(settingsRepository, 'put').mockRejectedValue(new Error('disk full'))
      vi.spyOn(settingsRepository, 'delete').mockRejectedValue(new Error('disk full'))
      vi.spyOn(settingsRepository, 'writeMany').mockRejectedValue(new Error('disk full'))
      expect(await spec.write(c.value as never)).toBe(false)
      expect(fieldsOf(spec, useSettingsStore.getState())).toEqual(before)
      expect(useUndoStore.getState().undoStack).toHaveLength(0)
      expect(useUndoStore.getState().snackbar).toEqual(c.failure ? { description: c.failure, notice: true } : null)
      expect(error).toHaveBeenCalledWith(`Failed to save ${spec.label}:`, expect.any(Error))
    })
  })
})
