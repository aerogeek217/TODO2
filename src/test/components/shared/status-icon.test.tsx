import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StatusIcon, STATUS_ICON_KEYS } from '../../../components/shared/StatusIcon'
import { StatusMark } from '../../../components/shared/StatusMark'
import { AppIcon } from '../../../components/shared/AppIcon'

afterEach(cleanup)

describe('StatusIcon', () => {
  it.each(STATUS_ICON_KEYS)('draws %s in the picker (outline) and in a row (filled)', (key) => {
    for (const filled of [false, true]) {
      const { container, unmount } = render(<StatusIcon icon={key} filled={filled} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.querySelectorAll('path, circle').length).toBeGreaterThan(0)
      unmount()
    }
  })

  it('draws nothing for a key this build does not know', () => {
    const { container } = render(<StatusIcon icon="rocket" filled />)
    expect(container.firstChild).toBeNull()
  })

  it('fills the disc icons with the bars and the person cut out', () => {
    for (const key of ['pause-circle', 'person-circle'] as const) {
      const { container, unmount } = render(<StatusIcon icon={key} filled />)
      expect(container.querySelector('svg')?.getAttribute('fill-rule')).toBe('evenodd')
      unmount()
    }
  })
})

describe('StatusMark (J17)', () => {
  it('draws the glyph, the default one without', () => {
    const { container, unmount } = render(<StatusMark status={{ icon: 'clock' }} filled />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('[data-app-icon]')).toBeNull()
    unmount()
    const { container: c2 } = render(<StatusMark status={{}} />)
    expect(c2.querySelector('svg circle')).not.toBeNull()
  })

  it('draws the emoji instead where the status has one: muted (tinted by the color around it) or in its colors', () => {
    const { container, unmount } = render(<span style={{ color: '#e0a030' }}><StatusMark status={{ icon: 'clock', emoji: '⏳' }} filled /></span>)
    const muted = container.querySelector('[data-app-icon="emoji-muted"]')
    expect(muted).toHaveTextContent('⏳')
    expect(muted?.querySelector('filter')).not.toBeNull()
    expect(muted).toHaveStyle({ fontSize: '1em' })
    unmount()
    const { container: c2 } = render(<StatusMark status={{ icon: 'clock', emoji: '⏳', emojiShow: 'color' }} />)
    const color = c2.querySelector('[data-app-icon="emoji-color"]')
    expect(color).toHaveTextContent('⏳')
    expect(color?.querySelector('filter')).toBeNull()
  })
})

describe('AppIcon (status glyphs, J17)', () => {
  it('draws a status glyph at its size', () => {
    const { container } = render(<AppIcon icon={{ kind: 'status', key: 'star' }} size={16} />)
    const box = container.querySelector('[data-app-icon="status"]')
    expect(box).toHaveStyle({ fontSize: '16px' })
    expect(box?.querySelector('svg')).not.toBeNull()
  })
})
