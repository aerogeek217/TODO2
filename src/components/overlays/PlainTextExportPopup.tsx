import { useEffect, useCallback, useState, useRef } from 'react'
import type { PersistedTodoItem, Person, Tag, Status } from '../../models'
import { Priority } from '../../models'
import { buildHierarchy } from '../../utils/hierarchy'
import styles from './PlainTextExportPopup.module.css'

interface Section {
  key: string
  label: string
  todos: PersistedTodoItem[]
}

interface PlainTextExportPopupProps {
  sections: Section[]
  assignedPeopleMap: Map<number, Person[]>
  assignedTagsMap: Map<number, Tag[]>
  statusMap: Map<number, Status>
  onClose: () => void
}

function formatTodoLine(todo: PersistedTodoItem, indent: string, people: Person[], tags: Tag[], statusMap: Map<number, Status>): string {
  const check = todo.isCompleted ? '[x]' : '[ ]'
  const star = todo.isStarred ? ' [F/U]' : ''
  const pri = todo.priority === Priority.High ? ' [HIGH]' : todo.priority === Priority.Medium ? ' [MED]' : ''
  const due = todo.dueDate ? ` (due ${new Date(todo.dueDate).toLocaleDateString()})` : ''
  const assigned = todo.isAssigned ? ' [ASSIGNED]' : ''
  const status = todo.statusId ? statusMap.get(todo.statusId) : undefined
  const statusStr = status ? ` [${status.name}]` : ''
  const peopleStr = people.length > 0 ? ` @${people.map(p => p.name).join(', @')}` : ''
  const tagStr = tags.length > 0 ? ` #${tags.map(t => t.name).join(', #')}` : ''
  return `${indent}${check} ${todo.title}${star}${pri}${statusStr}${due}${assigned}${peopleStr}${tagStr}`
}

function generatePlainText(
  sections: Section[],
  assignedPeopleMap: Map<number, Person[]>,
  assignedTagsMap: Map<number, Tag[]>,
  statusMap: Map<number, Status>,
): string {
  const lines: string[] = []

  for (const section of sections) {
    if (section.todos.length === 0) continue
    lines.push(`== ${section.label} ==`)
    const hierarchy = buildHierarchy(section.todos)
    for (const { parent, children } of hierarchy) {
      const people = assignedPeopleMap.get(parent.id) ?? []
      const tags = assignedTagsMap.get(parent.id) ?? []
      lines.push(formatTodoLine(parent, '  ', people, tags, statusMap))
      for (const child of children) {
        const cp = assignedPeopleMap.get(child.id) ?? []
        const ct = assignedTagsMap.get(child.id) ?? []
        lines.push(formatTodoLine(child, '    ', cp, ct, statusMap))
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

export function PlainTextExportPopup({ sections, assignedPeopleMap, assignedTagsMap, statusMap, onClose }: PlainTextExportPopupProps) {
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLPreElement>(null)

  const text = generatePlainText(sections, assignedPeopleMap, assignedTagsMap, statusMap)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select the text so user can Ctrl+C
      if (contentRef.current) {
        const range = document.createRange()
        range.selectNodeContents(contentRef.current)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(range)
      }
    }
  }, [text])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.dialog}>
        <div className={styles.header}>
          <div className={styles.title}>Plain Text Export</div>
        </div>
        <pre className={styles.content} ref={contentRef}>{text}</pre>
        <div className={styles.actions}>
          <button className={styles.closeButton} onClick={onClose}>Close</button>
          <button className={styles.copyButton} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
        </div>
      </div>
    </>
  )
}
