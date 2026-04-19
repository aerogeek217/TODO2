import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { HorizonRibbon } from '../../components/dashboard/HorizonRibbon'
import { HORIZON_KEYS, type HorizonKey } from '../../services/horizons'
import type { PersistedTodoItem } from '../../models'

function emptyTasksByHorizon() {
  const out = {} as Record<HorizonKey, PersistedTodoItem[]>
  for (const k of HORIZON_KEYS) out[k] = []
  return out
}

function emptyLabels() {
  const out = {} as Record<HorizonKey, string>
  for (const k of HORIZON_KEYS) out[k] = k
  return out
}

describe('HorizonRibbon', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders 5 tabs wired to the hero panel id and the selected tab is tabIndex=0', () => {
    const { container } = render(
      <HorizonRibbon
        tasksByHorizon={emptyTasksByHorizon()}
        labelsByHorizon={emptyLabels()}
        selectedHorizon="thisweek"
        today={new Date(2026, 3, 16)}
        weekStartsOn={1}
        onSelect={() => {}}
        unmappedSlots={new Set()}
        heroPanelId="hero-panel"
        tabIdFor={(k) => `tab-${k}`}
      />,
    )
    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]')
    expect(tabs.length).toBe(5)
    for (const t of Array.from(tabs)) {
      expect(t.getAttribute('aria-controls')).toBe('hero-panel')
    }
    const selected = container.querySelector<HTMLElement>('[aria-selected="true"]')
    expect(selected?.getAttribute('data-horizon')).toBe('thisweek')
    expect(selected?.getAttribute('tabindex')).toBe('0')
    const others = container.querySelectorAll<HTMLElement>('[aria-selected="false"]')
    for (const o of Array.from(others)) {
      expect(o.getAttribute('tabindex')).toBe('-1')
    }
  })

  it('arrow keys move selection horizontally (and wrap)', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <HorizonRibbon
        tasksByHorizon={emptyTasksByHorizon()}
        labelsByHorizon={emptyLabels()}
        selectedHorizon="thisweek"
        today={new Date(2026, 3, 16)}
        weekStartsOn={1}
        onSelect={onSelect}
        unmappedSlots={new Set()}
      />,
    )
    const selected = container.querySelector<HTMLElement>('[aria-selected="true"]')!
    fireEvent.keyDown(selected, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('nextweek')
    fireEvent.keyDown(selected, { key: 'ArrowLeft' })
    // from "thisweek" → ArrowLeft wraps to last ("someday")
    expect(onSelect).toHaveBeenLastCalledWith('someday')
    fireEvent.keyDown(selected, { key: 'End' })
    expect(onSelect).toHaveBeenLastCalledWith('someday')
    fireEvent.keyDown(selected, { key: 'Home' })
    expect(onSelect).toHaveBeenLastCalledWith('thisweek')
  })

  it('renders Edit horizons button only when onEditHorizons is provided', () => {
    const onEditHorizons = vi.fn()
    const { getByText, rerender, queryByText } = render(
      <HorizonRibbon
        tasksByHorizon={emptyTasksByHorizon()}
        labelsByHorizon={emptyLabels()}
        selectedHorizon="thisweek"
        today={new Date(2026, 3, 16)}
        weekStartsOn={1}
        onSelect={() => {}}
        unmappedSlots={new Set()}
        onEditHorizons={onEditHorizons}
      />,
    )
    const btn = getByText(/Edit horizons/i)
    fireEvent.click(btn)
    expect(onEditHorizons).toHaveBeenCalled()

    rerender(
      <HorizonRibbon
        tasksByHorizon={emptyTasksByHorizon()}
        labelsByHorizon={emptyLabels()}
        selectedHorizon="thisweek"
        today={new Date(2026, 3, 16)}
        weekStartsOn={1}
        onSelect={() => {}}
        unmappedSlots={new Set()}
      />,
    )
    expect(queryByText(/Edit horizons/i)).toBeNull()
  })

  it('unmapped-slot placeholder is role="tab" and keyboard-navigable', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <HorizonRibbon
        tasksByHorizon={emptyTasksByHorizon()}
        labelsByHorizon={emptyLabels()}
        selectedHorizon="thisweek"
        today={new Date(2026, 3, 16)}
        weekStartsOn={1}
        onSelect={onSelect}
        unmappedSlots={new Set(['later'])}
        heroPanelId="hero-panel"
      />,
    )
    const later = container.querySelector<HTMLElement>('[data-horizon="later"]')!
    expect(later.getAttribute('role')).toBe('tab')
    expect(later.getAttribute('aria-selected')).toBe('false')
    expect(later.getAttribute('aria-controls')).toBe('hero-panel')
    fireEvent.keyDown(later, { key: 'ArrowRight' })
    expect(onSelect).toHaveBeenLastCalledWith('someday')
  })
})
