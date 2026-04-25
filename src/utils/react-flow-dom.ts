/**
 * React Flow renders every controlled node into an element with the
 * `react-flow__node` class. Code that walks the DOM from a child element back
 * up to the owning node (resize handles, context-menu hit-tests, body
 * preview write targets) reaches for it via `closest`. Centralising the
 * selector + class name avoids the literal drifting across files.
 */
export const REACT_FLOW_NODE_CLASS = 'react-flow__node'
export const REACT_FLOW_NODE_SELECTOR = `.${REACT_FLOW_NODE_CLASS}` as const
