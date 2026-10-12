import type { AutocompleteState, AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import styles from './NlpAutocomplete.module.css'

interface NlpAutocompleteProps {
  state: AutocompleteState
  onSelect: (item: AutocompleteItem) => void
  /** Called when the create row (`#tag` / `@person` with no match) is clicked. */
  onCreateNew?: () => void
}

function headerLabel(state: AutocompleteState): string {
  if (state.trigger === '#') return 'Tags'
  if (state.trigger === ':') return 'Statuses'
  return 'People'
}

export function NlpAutocomplete({ state, onSelect, onCreateNew }: NlpAutocompleteProps) {
  if (!state.visible) return null

  if (state.items.length === 0 && !state.createNew) return null
  const isPersonCreate = state.createNew && state.trigger === '@'

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
        </button>
      ))}
      {state.createNew && (
        <button
          className={`${styles.item} ${isPersonCreate ? `${styles.createPerson} ${styles.selected}` : styles.createNew}`}
          onMouseDown={(e) => {
            e.preventDefault()
            onCreateNew?.()
          }}
        >
          {isPersonCreate && (
            <span className={styles.newAvatar} aria-hidden="true">
              {state.rawQuery.charAt(0).toUpperCase()}
            </span>
          )}
          <span className={styles.name}>
            {isPersonCreate
              ? `Press ⏎ to create @${state.rawQuery}`
              : `Press Enter to create #${state.query}`}
          </span>
        </button>
      )}
    </div>
  )
}
