import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { useListWidgetCount } from '../widget-hooks'
import { SaveIcon } from '../../shared/icons'

/**
 * A cell header's save button for a list with unsaved edits. The edits belong
 * to the list, so saving updates every widget showing it; the tooltip says
 * how many share it.
 */
export function SaveListButton({ listDefinitionId, className }: { listDefinitionId: number; className?: string }) {
  const name = useListDefinitionStore((s) => s.listDefinitions.find((d) => d.id === listDefinitionId)?.name ?? 'List')
  const widgets = useListWidgetCount(listDefinitionId)
  const title = widgets > 1 ? `Save list “${name}”\nShared · shown in ${widgets} widgets` : `Save list “${name}”`
  return (
    <button
      type="button"
      className={className}
      aria-label={`Save list “${name}” (unsaved changes)`}
      title={title}
      data-testid="save-list"
      onClick={() => { void useListDraftStore.getState().save(listDefinitionId) }}
    >
      <SaveIcon />
    </button>
  )
}
