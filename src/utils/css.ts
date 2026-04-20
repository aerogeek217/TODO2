const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function isValidCssColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}
