import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { TabNameIconPopover } from '../../../components/workspace/TabNameIconPopover'
import { db } from '../../../data/database'
import { rowFixes, validateRow } from '../../../data/import-validation'
import { layoutRepository } from '../../../data/layout-repository'
import { settleLayoutWrites, useWorkspaceStore } from '../../../stores/workspace-store'
import { TAB_NAME_MAX, createTab, kindTabTitle, type LayoutTab, type WidgetKind } from '../../../models/workspace-layout'
import { CHART_NAME_MAX } from '../../../models/chart-widgets'
import { NUMBER_NAME_MAX } from '../../../models/glance-widgets'
import { getTab } from '../../../utils/workspace-layout-queries'
import { resetDb } from '../../helpers'
import { single } from '../../helpers/layout-builders'

/**
 * Name and icon…'s Name field takes the limit of the tab's kind (cr34 H2 /
 * D1): a Number's and a chart's name is their own `config.name`, which the
 * stored shape keeps shorter than a tab's name. What the field lets through
 * is what `renameTab` writes, and the stored layout imports.
 */

const AT = new Date('2026-09-01T09:00:00.000Z')

async function open(tabs: LayoutTab[]): Promise<number> {
  const id = await layoutRepository.insert({ name: 'Main', createdAt: AT, modifiedAt: AT, ...single({ id: 'k', tabs }) })
  await layoutRepository.setActiveId(id)
  await useWorkspaceStore.getState().init()
  return id
}

function nameField(tabId: string): HTMLInputElement {
  render(<TabNameIconPopover tabId={tabId} anchor={{ x: 10, y: 10 }} onClose={() => {}} />)
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Name' })
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

afterEach(() => cleanup())

describe('Name and icon…: the Name field’s limit', () => {
  const LIMITS: Array<[WidgetKind, number]> = [
    ['number', NUMBER_NAME_MAX],
    ['breakdown', CHART_NAME_MAX],
    ['pivot', CHART_NAME_MAX],
    ['trend', CHART_NAME_MAX],
    ['notes', TAB_NAME_MAX],
    ['calendar', TAB_NAME_MAX],
  ]

  it.each(LIMITS)('a %s tab’s field takes %i characters', async (kind, max) => {
    await open([createTab(kind, 't1')])
    expect(nameField('t1').maxLength).toBe(max)
  })

  it('the longest name the field takes on a Number is stored whole, and the layout imports', async () => {
    const id = await open([createTab('number', 'u1')])
    const field = nameField('u1')
    const longest = 'N'.repeat(field.maxLength)
    fireEvent.change(field, { target: { value: longest } })
    // The name is written when the popover goes.
    cleanup()
    await settleLayoutWrites()
    const row = await db.layouts.get(id)
    expect(kindTabTitle(getTab(useWorkspaceStore.getState().working!, 'u1')!)).toBe(longest)
    expect(validateRow('layouts', row)).toBe(true)
    expect(rowFixes('layouts', row)).toEqual([])
  })

  it('text past the limit (set without typing) is cut when it is written', async () => {
    const id = await open([createTab('breakdown', 'b1')])
    fireEvent.change(nameField('b1'), { target: { value: 'B'.repeat(TAB_NAME_MAX) } })
    cleanup()
    await settleLayoutWrites()
    expect(kindTabTitle(getTab(useWorkspaceStore.getState().working!, 'b1')!)).toBe('B'.repeat(CHART_NAME_MAX))
    expect(validateRow('layouts', await db.layouts.get(id))).toBe(true)
  })
})
