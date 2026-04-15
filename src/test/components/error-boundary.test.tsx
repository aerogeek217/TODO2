import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { ErrorBoundary } from '../../components/shared/ErrorBoundary'

function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message)
}

describe('ErrorBoundary', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Suppress React's expected error logs for these tests
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    cleanup()
  })

  it('renders children when no error', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <div>healthy</div>
      </ErrorBoundary>,
    )
    expect(getByText('healthy')).toBeTruthy()
  })

  it('renders default fallback when child throws', () => {
    const { getByText, getByRole } = render(
      <ErrorBoundary scope="Canvas">
        <Boom message="canvas exploded" />
      </ErrorBoundary>,
    )
    expect(getByRole('alert')).toBeTruthy()
    expect(getByText(/Canvas failed to render/)).toBeTruthy()
    expect(getByText(/canvas exploded/)).toBeTruthy()
  })

  it('renders generic title when scope not provided', () => {
    const { getByText } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(getByText('Something went wrong')).toBeTruthy()
  })

  it('calls custom fallback renderer with error + reset', () => {
    const fallback = vi.fn((err: Error, reset: () => void) => (
      <div>
        <span>custom: {err.message}</span>
        <button onClick={reset}>retry</button>
      </div>
    ))
    const { getByText } = render(
      <ErrorBoundary fallback={fallback}>
        <Boom message="kaboom" />
      </ErrorBoundary>,
    )
    expect(fallback).toHaveBeenCalled()
    expect(getByText('custom: kaboom')).toBeTruthy()
  })

  it('reset button clears error state', () => {
    // Child that throws once, then recovers
    let shouldThrow = true
    function MaybeBoom() {
      if (shouldThrow) throw new Error('first')
      return <div>recovered</div>
    }
    const { getByText } = render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    )
    expect(getByText(/first/)).toBeTruthy()
    shouldThrow = false
    fireEvent.click(getByText('Try again'))
    expect(getByText('recovered')).toBeTruthy()
  })

  it('logs caught error to console with scope', () => {
    render(
      <ErrorBoundary scope="TestScope">
        <Boom message="logged" />
      </ErrorBoundary>,
    )
    const scopedCall = errorSpy.mock.calls.find(
      (call: unknown[]) => call[0] === '[ErrorBoundary]' && call[1] === 'TestScope',
    )
    expect(scopedCall).toBeTruthy()
  })
})
