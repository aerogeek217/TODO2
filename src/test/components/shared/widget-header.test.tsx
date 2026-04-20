import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { WidgetHeader } from '../../../components/shared/WidgetHeader'
import { KIND_ICON } from '../../../utils/slot-kind'

afterEach(() => cleanup())

describe('WidgetHeader', () => {
  it.each(['lens', 'notes', 'calendar', 'taskboard'] as const)(
    'renders the kind icon for %s',
    (kind) => {
      render(<WidgetHeader kind={kind} title="Title" />)
      expect(screen.getByText(KIND_ICON[kind])).toBeInTheDocument()
    },
  )

  it('renders title and meta', () => {
    render(<WidgetHeader kind="lens" title="My List" meta={7} />)
    expect(screen.getByText('My List')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('fires onClose on × click with kind-aware aria label', () => {
    const onClose = vi.fn()
    render(<WidgetHeader kind="notes" title="Notes" onClose={onClose} />)
    const btn = screen.getByRole('button', { name: /close notes/i })
    fireEvent.click(btn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fires onDock on ↗ click (floating surface)', () => {
    const onDock = vi.fn()
    render(<WidgetHeader kind="calendar" title="Calendar" onDock={onDock} floating />)
    fireEvent.click(screen.getByRole('button', { name: /dock calendar to rail/i }))
    expect(onDock).toHaveBeenCalledTimes(1)
  })

  it('fires onPopOut on ↙ click (rails surface)', () => {
    const onPopOut = vi.fn()
    render(<WidgetHeader kind="lens" title="L" onPopOut={onPopOut} />)
    fireEvent.click(screen.getByRole('button', { name: /pop out list slot/i }))
    expect(onPopOut).toHaveBeenCalledTimes(1)
  })

  it('fires onMore with a button-rect anchor', () => {
    const onMore = vi.fn()
    render(<WidgetHeader kind="lens" title="L" onMore={onMore} />)
    fireEvent.click(screen.getByRole('button', { name: /list options/i }))
    expect(onMore).toHaveBeenCalledTimes(1)
    const [anchor] = onMore.mock.calls[0]!
    expect(anchor).toHaveProperty('x')
    expect(anchor).toHaveProperty('y')
  })

  it('renders collapse button and fires onToggleCollapse', () => {
    const onToggleCollapse = vi.fn()
    render(
      <WidgetHeader
        kind="lens"
        title="L"
        collapsed={false}
        onToggleCollapse={onToggleCollapse}
      />,
    )
    const btn = screen.getByRole('button', { name: /collapse list/i })
    fireEvent.click(btn)
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  it('shows expand label when collapsed', () => {
    render(
      <WidgetHeader
        kind="lens"
        title="L"
        collapsed
        onToggleCollapse={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /expand list/i })).toBeInTheDocument()
  })

  it('omits optional buttons when their callbacks are absent', () => {
    render(<WidgetHeader kind="lens" title="L" />)
    expect(screen.queryByRole('button', { name: /pop out/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /dock/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /options/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('adds nopan nodrag classes to icon buttons on floating surfaces', () => {
    render(<WidgetHeader kind="notes" title="N" onClose={() => {}} floating />)
    const btn = screen.getByRole('button', { name: /close notes/i })
    expect(btn.className).toMatch(/nopan/)
    expect(btn.className).toMatch(/nodrag/)
  })

  it('does not add nopan/nodrag on rails surface', () => {
    render(<WidgetHeader kind="lens" title="L" onClose={() => {}} />)
    const btn = screen.getByRole('button', { name: /close list/i })
    expect(btn.className).not.toMatch(/nopan/)
  })

  it('renders title as a button when onTitleClick is provided', () => {
    const onTitleClick = vi.fn()
    render(<WidgetHeader kind="lens" title="This week" onTitleClick={onTitleClick} />)
    const titleBtn = screen.getByRole('button', { name: /change list/i })
    expect(titleBtn.textContent).toContain('This week')
    expect(titleBtn).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.click(titleBtn)
    expect(onTitleClick).toHaveBeenCalled()
    expect(typeof onTitleClick.mock.calls[0][0].x).toBe('number')
    expect(typeof onTitleClick.mock.calls[0][0].y).toBe('number')
  })

  it('exposes aria-expanded on the title button when menu is open', () => {
    render(<WidgetHeader kind="notes" title="N" onTitleClick={() => {}} titleMenuOpen />)
    expect(screen.getByRole('button', { name: /change notes/i })).toHaveAttribute('aria-expanded', 'true')
  })
})
