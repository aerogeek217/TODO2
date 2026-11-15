import { afterEach, describe, expect, it } from 'vitest'
import { attrSelector, widgetElement, widgetPopupOf, WIDGET_POPUP_ATTR } from '../../utils/dom-contract'

/**
 * Ids in selectors (cr34 S5): a stored tab id is any string — a quote, a
 * backslash, a leading digit (a UUID) — so `attrSelector` escapes the value
 * it is given, and the selector it makes finds the element and never throws.
 */

afterEach(() => { document.body.replaceChildren() })

describe('attrSelector', () => {
  it('without a value, the attribute alone', () => {
    expect(attrSelector('data-x')).toBe('[data-x]')
  })

  it.each(['plain', 'has "quotes"', 'back\\slash', '1e0a7c2-uuid', 'line\nbreak'])('finds the element whose value is %j, and never throws', (value) => {
    const el = document.createElement('div')
    el.setAttribute('data-x', value)
    document.body.append(el, document.createElement('div'))
    expect(document.querySelector(attrSelector('data-x', value))).toBe(el)
  })
})

describe('the widget popup by tab id', () => {
  it('finds the popup showing a tab whose id holds a quote, and the element inside it', () => {
    const id = 'tab "one"'
    const popup = document.createElement('div')
    popup.setAttribute(WIDGET_POPUP_ATTR, id)
    const inner = document.createElement('span')
    inner.className = 'target'
    popup.append(inner)
    const outside = document.createElement('span')
    outside.className = 'target'
    document.body.append(outside, popup)
    expect(widgetPopupOf(id)).toBe(popup)
    expect(widgetElement(id, '.target')).toBe(inner)
    expect(widgetPopupOf('other')).toBeNull()
    expect(widgetElement('other', '.target')).toBe(outside)
  })
})
