import { describe, it, expect, vi, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MarkFollowedUpButton } from '../../../components/shared/followup/MarkFollowedUpButton'
import styles from '../../../components/shared/followup/Followup.module.css'

describe('<MarkFollowedUpButton>', () => {
  afterEach(cleanup)

  it('is always labelled Mark followed up, with the flag-check icon, and clicks through', () => {
    const onClick = vi.fn()
    render(<MarkFollowedUpButton onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Mark followed up' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button).toHaveClass(styles.markFollowedUp!)
    expect(button).not.toHaveAttribute('data-done-today')
    expect(button).not.toHaveClass(styles.markFollowedUpDone!)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('done today: data-done-today and the quiet look; `dimmed` overrides only the look', () => {
    render(<MarkFollowedUpButton doneToday />)
    let button = screen.getByRole('button', { name: 'Mark followed up' })
    expect(button).toHaveAttribute('data-done-today', 'true')
    expect(button).toHaveClass(styles.markFollowedUpDone!)
    cleanup()

    render(<MarkFollowedUpButton doneToday dimmed={false} />)
    button = screen.getByRole('button', { name: 'Mark followed up' })
    expect(button).toHaveAttribute('data-done-today', 'true')
    expect(button).not.toHaveClass(styles.markFollowedUpDone!)
  })

  it('passes ref, disabled and other props through; fullWidth and className add classes', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<MarkFollowedUpButton ref={ref} disabled fullWidth className="extra" aria-describedby="tip" />)
    const button = screen.getByRole('button', { name: 'Mark followed up' })
    expect(ref.current).toBe(button)
    expect(button).toBeDisabled()
    expect(button).toHaveClass(styles.markFollowedUpFull!, 'extra')
    expect(button).toHaveAttribute('aria-describedby', 'tip')
  })

  it('a trailing adornment shows after the label, outside the accessible name', () => {
    render(<MarkFollowedUpButton adornment="› ⏎" />)
    const button = screen.getByRole('button', { name: 'Mark followed up' })
    expect(button).toHaveTextContent('Mark followed up› ⏎')
    expect(screen.getByText('› ⏎')).toHaveAttribute('aria-hidden', 'true')
  })
})
