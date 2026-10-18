import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { WidgetBody } from '../../../components/workspace/WidgetBody'
import { tabTitle } from '../../../components/workspace/widget-hooks'
import { UNKNOWN_WIDGET_LABEL, widgetKindLabel, type LayoutTab } from '../../../models/workspace-layout'

afterEach(cleanup)

// Stored data isn't typed: a tab of a kind this build doesn't know must not
// crash the cell (the layout load repair drops such tabs; this is the last guard).
const retired = { id: 'old', kind: 'status', config: {} } as unknown as LayoutTab

describe('a tab of an unknown kind', () => {
  it('renders a note in the cell body', () => {
    const { container } = render(<WidgetBody tab={retired} />)
    const note = container.querySelector('[data-unknown-widget]')
    expect(note).toHaveAttribute('data-unknown-widget', 'status')
    expect(note).toHaveTextContent("This widget can't be shown in this version of TODO2.")
  })

  it('has a label for its tab', () => {
    expect(widgetKindLabel(retired.kind)).toBe(UNKNOWN_WIDGET_LABEL)
    expect(tabTitle(retired, undefined)).toBe('Unknown widget')
    expect(widgetKindLabel('calendar')).toBe('Calendar')
  })
})
