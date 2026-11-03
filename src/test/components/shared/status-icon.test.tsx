import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { StatusIcon, STATUS_ICON_KEYS } from '../../../components/shared/StatusIcon'

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
