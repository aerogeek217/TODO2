import type { AutocompleteState, AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import styles from './NlpAutocomplete.module.css'

interface NlpAutocompleteProps {
  state: AutocompleteState
  onSelect: (item: AutocompleteItem) => void
  /** Called when the "Press Enter to create #<query>" hint row is clicked. */
  onCreateNew?: () => void
}

function headerLabel(state: AutocompleteState): string {
  if (state.trigger === '#') return 'Tags'
  if (state.trigger === '/') return 'Projects'
  const hasOrgs = state.items.some((item) => item.kind === 'org')
  return hasOrgs ? 'People & Orgs' : 'People'
}

export function NlpAutocomplete({ state, onSelect, onCreateNew }: NlpAutocompleteProps) {
  if (!state.visible) return null

  const isTagCreateNew = state.trigger === '#' && state.items.length === 0 && state.query.length > 0
  if (state.items.length === 0 && !isTagCreateNew) return null

  return (
    <div className={styles.dropdown} style={{ left: state.caretLeft }}>
      <div className={styles.header}>{headerLabel(state)}</div>
      {state.items.map((item, i) => (
        <button
          key={`${item.kind}-${item.id}`}
          className={`${styles.item} ${i === state.selectedIndex ? styles.selected : ''}`}
          onMouseDown={(e) => {
            e.preventDefault() // prevent input blur
            onSelect(item)
          }}
        >
          {item.color && (
            <span className={styles.dot} style={{ background: item.color }} />
          )}
          <span className={styles.name}>
            {state.trigger}{item.name}
          </span>
          {item.kind === 'org' && (
            <span className={styles.kindLabel}>(org)</span>
          )}
        </button>
      ))}
      {isTagCreateNew && (
        <button
          className={`${styles.item} ${styles.createNew}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onCreateNew?.()
          }}
        >
          <span className={styles.name}>
            Press Enter to create #{state.query}
          </span>
        </button>
      )}
    </div>
  )
}
