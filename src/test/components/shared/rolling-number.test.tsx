import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { RollingNumber } from '../../../components/shared/RollingNumber'
import { LightRing } from '../../../components/workspace/glance/LightRing'

afterEach(cleanup)

const digits = (c: HTMLElement) => [...c.querySelectorAll('[data-rolling-number] > span')] as HTMLElement[]

describe('RollingNumber', () => {
  it('nothing rolls on mount; its text is the plain figure', () => {
    const { container } = render(<RollingNumber value={42} />)
    expect(container.textContent).toBe('42')
    expect(container.querySelectorAll('[data-prev]')).toHaveLength(0)
  })

  it('only the digits that changed roll, up as it rises, the units lined up from the right', () => {
    const { container, rerender } = render(<RollingNumber value={42} />)
    rerender(<RollingNumber value={43} />)
    expect(container.textContent).toBe('43')
    const [tens, units] = digits(container)
    expect(tens).not.toHaveAttribute('data-prev')
    expect(units).toHaveAttribute('data-prev', '2')
    expect(units).toHaveAttribute('data-dir', 'up')
  })

  it('down as it falls; a digit that goes just goes (10 → 9)', () => {
    const { container, rerender } = render(<RollingNumber value={10} />)
    rerender(<RollingNumber value={9} />)
    expect(container.textContent).toBe('9')
    const [units] = digits(container)
    expect(units).toHaveAttribute('data-prev', '0')
    expect(units).toHaveAttribute('data-dir', 'down')
    expect(digits(container)).toHaveLength(1)
  })

  it('non-digits never roll (a percent sign, a dash)', () => {
    const { container, rerender } = render(<RollingNumber value="45%" />)
    rerender(<RollingNumber value="—" />)
    expect(container.querySelectorAll('[data-prev]')).toHaveLength(0)
  })
})

describe('LightRing', () => {
  const ring = (c: HTMLElement) => c.querySelector('[data-light-ring]')
  it('shows a ring when lit turns unlit, not on mount nor on becoming lit', () => {
    const { container, rerender } = render(<LightRing lit color="red" />)
    expect(ring(container)).toBeNull()
    rerender(<LightRing lit={false} color="red" />)
    expect(ring(container)).not.toBeNull()
    expect(ring(container)).toHaveAttribute('aria-hidden', 'true')
    cleanup()
    const off = render(<LightRing lit={false} color="red" />)
    off.rerender(<LightRing lit color="red" />)
    expect(ring(off.container)).toBeNull()
  })
})
