import type { AutocompleteState, AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import styles from './NlpAutocomplete.module.css'

interface NlpAutocompleteProps {
  state: AutocompleteState
  onSelect: (item: AutocompleteItem) => void
}

export function NlpAutocomplete({ state, onSelect }: NlpAutocompleteProps) {
  if (!state.visible || state.items.length === 0) return null

  return (
    <div className={styles.dropdown} style={{ left: state.caretLeft }}>
      <div className={styles.header}>
        {state.trigger === '@' ? 'People' : state.trigger === '#' ? 'Tags' : 'Projects'}
      </div>
      {state.items.map((item, i) => (
        <button
          key={item.id}
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
    </div>
  )
}
