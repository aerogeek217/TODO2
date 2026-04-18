import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { LensTitleButton } from '../../../components/canvas/rails/LensTitleButton'

afterEach(cleanup)

describe('LensTitleButton', () => {
  it('renders the label and calls onOpen with the button bottom-left on click', () => {
    const onOpen = vi.fn()
    const { getByRole } = render(<LensTitleButton label="This week" onOpen={onOpen} />)
    const btn = getByRole('button', { name: /change lens list/i })
    expect(btn.textContent).toContain('This week')
    // jsdom returns all-zero rects, but we can still verify the callback fires
    // with numeric coordinates.
    fireEvent.click(btn)
    expect(onOpen).toHaveBeenCalledTimes(1)
    const [x, y] = onOpen.mock.calls[0]
    expect(typeof x).toBe('number')
    expect(typeof y).toBe('number')
  })
})
