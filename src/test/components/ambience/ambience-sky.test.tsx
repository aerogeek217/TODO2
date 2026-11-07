import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { AmbienceSky } from '../../../components/ambience/AmbienceSky'
import { AmbienceBackdrop, AmbienceLamp } from '../../../components/ambience/AmbienceWorkspace'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { DEFAULT_AMBIENCE } from '../../../models/ambience'
import { makeTodo } from '../../helpers'

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useTodoStore.setState(useTodoStore.getInitialState(), true)
})

afterEach(cleanup)

describe('AmbienceSky', () => {
  it('draws the sky layer and the hairline layer while on', () => {
    const { container } = render(<header style={{ position: 'relative' }}><AmbienceSky /></header>)
    expect(container.querySelector('[data-ambience="sky"]')).not.toBeNull()
    expect(container.querySelector('[data-ambience="hairline"]')).not.toBeNull()
  })

  it('draws nothing while off', () => {
    useSettingsStore.setState({ ambience: { ...DEFAULT_AMBIENCE, enabled: false } })
    const { container } = render(<header><AmbienceSky /><AmbienceBackdrop /><AmbienceLamp /></header>)
    expect(container.querySelector('[data-ambience]')).toBeNull()
  })

  it('sends a ripple along the hairline and a burst from the box when a task on screen is completed', () => {
    const todo = makeTodo({ id: 7, title: 'Renew the domain', isCompleted: false })
    useTodoStore.setState({ todos: [todo] })
    // Seasons on, so the burst shows whatever the clock says.
    const { container } = render(
      <>
        <header style={{ position: 'relative' }}><AmbienceSky /></header>
        <div data-todo-id="7"><input type="checkbox" /></div>
      </>,
    )
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    box.getBoundingClientRect = () => ({ left: 100, top: 200, width: 18, height: 18, right: 118, bottom: 218, x: 100, y: 200, toJSON: () => ({}) })
    act(() => { useTodoStore.setState({ todos: [{ ...todo, isCompleted: true }] }) })
    expect(container.querySelectorAll('[data-ambience="hairline"] > div').length).toBeGreaterThan(0)
    expect(document.body.querySelector('[class*="bursts"]')).not.toBeNull()
  })

  it('makes no ripple when many tasks complete at once (a bulk action)', () => {
    const todos = [1, 2, 3, 4].map((id) => makeTodo({ id, isCompleted: false }))
    useTodoStore.setState({ todos })
    useSettingsStore.setState({ ambience: { ...DEFAULT_AMBIENCE, seasons: false } })
    const { container } = render(<header style={{ position: 'relative' }}><AmbienceSky /></header>)
    const before = container.querySelectorAll('[data-ambience="hairline"] > div').length
    act(() => { useTodoStore.setState({ todos: todos.map((t) => ({ ...t, isCompleted: true })) }) })
    expect(container.querySelectorAll('[data-ambience="hairline"] > div').length).toBe(before)
  })
})
