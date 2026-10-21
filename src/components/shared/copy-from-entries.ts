import type { CopySource } from '../../hooks/use-copy-sources'
import type { CopySourceGroup } from '../../utils/list-copy'
import type { MenuEntry } from './MenuPopover'

/**
 * Copy from's entries: a heading per group (`useCopySources` — the layouts,
 * this one first, then the Eisenhower), each list under it with its filters
 * in words; a note when there is nothing to copy.
 */
export function copyFromEntries(groups: readonly CopySourceGroup<CopySource>[], onPick: (source: CopySource) => void): MenuEntry[] {
  const entries: MenuEntry[] = []
  for (const group of groups) {
    if (entries.length > 0) entries.push({ kind: 'separator' })
    entries.push({ kind: 'label', text: group.heading })
    for (const source of group.lists) {
      entries.push({ kind: 'item', label: source.name, description: source.hint, onSelect: () => onPick(source) })
    }
  }
  return entries.length > 0 ? entries : [{ kind: 'note', text: 'No lists to copy from.' }]
}
