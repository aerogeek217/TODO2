import type { PersistedListDefinition } from '../../models'
import styles from '../../views/ListView.module.css'

/**
 * One favorited-list chip rendered in the Favorites bar above the toolbar.
 * Click loads the list; the active state is driven by the parent comparing
 * `def.id` against the last-loaded id.
 */
export function FavoriteChip({
  def,
  isActive,
  onApply,
}: {
  def: PersistedListDefinition
  isActive: boolean
  onApply: (def: PersistedListDefinition) => void
}) {
  return (
    <div className={`${styles.savedViewChip} ${isActive ? styles.savedViewChipActive : ''}`}>
      <button
        className={styles.savedViewName}
        onClick={() => onApply(def)}
        title="Click to load this list"
      >
        {def.name}
      </button>
    </div>
  )
}

/**
 * Anchor-less overlay listing every `ListDefinition`. Used for both Save (with
 * a leading "+ New" entry) and Load (list only). Each row has a `×` that
 * routes through `onDelete` with a confirmation. Click the row to pick it.
 */
export function ListDefinitionSelector({
  defs,
  mode,
  onPickDef,
  onNew,
  onDelete,
  onClose,
}: {
  defs: PersistedListDefinition[]
  mode: 'save' | 'load'
  onPickDef: (def: PersistedListDefinition) => void
  onNew?: () => void
  onDelete: (def: PersistedListDefinition) => void
  onClose: () => void
}) {
  return (
    <>
      <div className={styles.dialogBackdrop} onClick={onClose} />
      <div className={styles.dialog}>
        <div className={styles.dialogTitle}>
          {mode === 'save' ? 'Save list' : 'Load list'}
        </div>
        <div className={styles.selectorList}>
          {mode === 'save' && onNew && (
            <button className={styles.selectorNewRow} onClick={onNew}>
              + New list
            </button>
          )}
          {defs.length === 0 && (
            <div className={styles.selectorEmpty}>No saved lists yet.</div>
          )}
          {defs.map((d) => (
            <div key={d.id} className={styles.selectorRow}>
              <button
                className={styles.selectorName}
                onClick={() => onPickDef(d)}
                title={mode === 'save' ? 'Overwrite this list' : 'Load this list'}
              >
                {d.name}
              </button>
              <button
                className={styles.selectorDelete}
                onClick={(e) => { e.stopPropagation(); onDelete(d) }}
                title="Delete list"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className={styles.dialogActions}>
          <button className={styles.dialogCancel} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </>
  )
}

/**
 * Modal prompting for a name when saving the current view as a brand-new
 * list. Controlled — parent owns `value`, `error`, and the confirm handler
 * so the persistence call can stay co-located with the rest of the
 * Save/Load flow in ListView.
 */
export function NewListPrompt({
  value,
  error,
  onChange,
  onConfirm,
  onCancel,
}: {
  value: string
  error: string
  onChange: (next: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className={styles.dialogBackdrop} onClick={onCancel} />
      <div className={styles.dialog}>
        <div className={styles.dialogTitle}>New list</div>
        <div className={styles.dialogHint}>
          Captures current filter + grouping as a reusable list and adds it to Favorites.
        </div>
        <input
          className={styles.dialogInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onConfirm()
            if (e.key === 'Escape') onCancel()
          }}
          placeholder="List name"
          autoFocus
        />
        {error && <div className={styles.dialogError}>{error}</div>}
        <div className={styles.dialogActions}>
          <button className={styles.dialogCancel} onClick={onCancel}>Cancel</button>
          <button className={styles.dialogConfirm} onClick={onConfirm} disabled={!value.trim()}>Save</button>
        </div>
      </div>
    </>
  )
}
