import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, cleanup } from '@testing-library/react'
import { SubtaskCountButton, SubtaskCountStatic } from '../../../components/task/subtasks/SubtaskCountButton'

/** The checklist pie before a row's `2/5` (D25 D2): its share done and its full (accent) state. */

afterEach(cleanup)

function pieOf(container: HTMLElement): HTMLElement {
  const pie = container.querySelector<HTMLElement>('[data-subtask-pie]')
  if (!pie) throw new Error('no pie')
  return pie
}

describe('the subtask count’s pie', () => {
  it('fills by the share done, before the unchanged count text', () => {
    for (const [done, total, share] of [[0, 5, 0], [2, 5, 40], [1, 3, 33], [5, 5, 100]] as const) {
      const { container, unmount } = render(
        <SubtaskCountButton count={{ done, total }} open={false} buttonRef={createRef()} onClick={vi.fn()} />,
      )
      const button = container.querySelector('[data-subtask-count]')
      const pie = pieOf(container)
      expect(pie.getAttribute('data-subtask-pie')).toBe(String(share))
      expect(pie.style.getPropertyValue('--subtask-share')).toBe(`${share}%`)
      expect(pie).toHaveAttribute('aria-hidden', 'true')
      expect(button?.firstElementChild).toBe(pie)
      expect(button).toHaveTextContent(new RegExp(`^${done}/${total}$`))
      unmount()
    }
  })

  it('is full and marks the count all done (the accent) only when every subtask is done', () => {
    const partial = render(<SubtaskCountButton count={{ done: 4, total: 5 }} open={false} buttonRef={createRef()} onClick={vi.fn()} />)
    expect(partial.container.querySelector('[data-subtask-count]')).not.toHaveAttribute('data-all-done')
    partial.unmount()

    const full = render(<SubtaskCountButton count={{ done: 5, total: 5 }} open={false} buttonRef={createRef()} onClick={vi.fn()} />)
    expect(full.container.querySelector('[data-subtask-count]')).toHaveAttribute('data-all-done')
    expect(pieOf(full.container).style.getPropertyValue('--subtask-share')).toBe('100%')
  })

  it('the drag overlay’s static count draws the same pie', () => {
    const { container } = render(<SubtaskCountStatic count={{ done: 3, total: 3 }} />)
    expect(pieOf(container).style.getPropertyValue('--subtask-share')).toBe('100%')
    expect(container.querySelector('[data-subtask-count]')).toHaveAttribute('data-all-done')
    expect(container.querySelector('[data-subtask-count]')).toHaveTextContent(/^3\/3$/)
  })
})
