import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { GlanceWidget } from '../../../components/workspace/glance/GlanceWidget'
import { createTab, isGlanceKind, isLensSwitchTab, tabIgnoresLens, WIDGET_KINDS, type GlanceTab, type GlanceWidgetKind } from '../../../models/workspace-layout'
import { WidgetLensContext } from '../../../hooks/use-widget-lens'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWidgetPreviewStore } from '../../../stores/widget-preview-store'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_LISTS, SAMPLE_TASKS, STATUSES, TAGS,
} from '../../fixtures/glance-sample'

/**
 * A tab id naming an `Object.prototype` member (cr34 S2): the editor-preview
 * store is keyed by tab id, and `configs['constructor']` on a plain object
 * read the inherited function — the Breakdown, Pivot and Project pulse threw
 * in render, the Number and Created vs completed drew from it. The layout
 * check now refuses such an id (`data/layout-shape.isId`,
 * `layout-shape.test`); these hold the store's own read, whatever the id.
 */

const PROTOTYPE_KEYS = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'] as const
const GLANCE_KINDS = WIDGET_KINDS.filter(isGlanceKind) as GlanceWidgetKind[]

function draw(tab: GlanceTab) {
  return render(
    <DndContext>
      <WidgetFaceContext.Provider value={{ forced: 'large' }}>
        <WidgetLensContext.Provider value={isLensSwitchTab(tab) && tabIgnoresLens(tab)}>
          <GlanceWidget tab={tab} onResult={() => {}} />
        </WidgetLensContext.Provider>
      </WidgetFaceContext.Provider>
    </DndContext>,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: ASSIGNED_PEOPLE })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the editor-preview store reads a tab’s own entry only', () => {
  it.each(PROTOTYPE_KEYS)('no preview for a tab named %s until one is set, and none after it is cleared', (id) => {
    const store = useWidgetPreviewStore.getState()
    expect(useWidgetPreviewStore.getState().configs[id]).toBeUndefined()
    const config = { name: 'Edited' }
    store.setPreview(id, config)
    expect(useWidgetPreviewStore.getState().configs[id]).toBe(config)
    // Another tab's entry is untouched by it, and its own is still its own.
    store.setPreview('w-1', { name: 'Other' })
    expect(useWidgetPreviewStore.getState().configs[id]).toBe(config)
    expect(Object.keys(useWidgetPreviewStore.getState().configs).sort()).toEqual([id, 'w-1'].sort())
    store.clearPreview(id)
    expect(useWidgetPreviewStore.getState().configs[id]).toBeUndefined()
    expect(Object.keys(useWidgetPreviewStore.getState().configs)).toEqual(['w-1'])
  })

  it('setting the same config again changes nothing; clearing a tab with no preview changes nothing', () => {
    const store = useWidgetPreviewStore.getState()
    const config = { name: 'Edited' }
    store.setPreview('w-1', config)
    const held = useWidgetPreviewStore.getState().configs
    store.setPreview('w-1', config)
    store.clearPreview('constructor')
    store.clearPreview('w-2')
    expect(useWidgetPreviewStore.getState().configs).toBe(held)
  })
})

describe('a glance widget whose tab id names an Object.prototype member draws its stored config', () => {
  for (const kind of GLANCE_KINDS) {
    it.each(PROTOTYPE_KEYS)(`a ${kind} named %s renders as one with a plain id does`, (id) => {
      const plain = draw(createTab(kind, 'plain'))
      const expected = plain.container.textContent
      expect(expected).not.toBe('')
      cleanup()
      const odd = draw(createTab(kind, id))
      expect(odd.container.textContent).toBe(expected)
    })
  }
})
