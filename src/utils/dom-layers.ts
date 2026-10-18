/** `node`'s ancestor (or itself) that is a direct child of `document.body`: the root of the portal it is in, or the app root. */
function bodyChild(node: Node): Node | null {
  let n: Node | null = node
  while (n && n.parentNode !== document.body) n = n.parentNode
  return n
}

/**
 * Whether `target` is in a layer stacked above `panel`: a portal root later
 * in `<body>` than the one `panel` is in (portals append in the order they
 * open) — a menu, a dialog or a confirm opened while `panel` was open, e.g.
 * from inside it. A popover leaves a press or a key there to that layer
 * instead of treating it as outside.
 */
export function isInLayerAbove(panel: Node, target: Node): boolean {
  const own = bodyChild(panel)
  const other = bodyChild(target)
  if (!own || !other || own === other) return false
  return (own.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * Whether a modal dialog is open in a layer stacked above `panel` — an Esc
 * with nothing focused is then that dialog's (the topmost one closes).
 */
export function hasModalAbove(panel: Node): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some((modal) => isInLayerAbove(panel, modal))
}
