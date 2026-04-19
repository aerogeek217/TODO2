import { useEffect, useCallback, useState, useRef } from 'react'
import type { PersistedTodoItem, Person, Status } from '../../models'
import { buildHierarchy } from '../../utils/hierarchy'
import { scheduledLabel } from '../../utils/effective-date'
import { startOfToday } from '../../utils/date'
import styles from './PlainTextExportPopup.module.css'

interface Section {
  key: string
  label: string
  todos: PersistedTodoItem[]
}

interface PlainTextExportPopupProps {
  sections: Section[]
  assignedPeopleMap: Map<number, Person[]>
  statusMap: Map<number, Status>
  onClose: () => void
}

function formatTodoLine(todo: PersistedTodoItem, indent: string, people: Person[], statusMap: Map<number, Status>, today: Date): string {
  const check = todo.isCompleted ? '[x]' : '[ ]'
  const sched = todo.scheduledDate ? ` (sched: ${scheduledLabel(todo.scheduledDate, today)})` : ''
  const deadline = todo.dueDate ? ` (deadline ${new Date(todo.dueDate).toLocaleDateString()})` : ''
  const status = todo.statusId ? statusMap.get(todo.statusId) : undefined
  const statusStr = status ? ` [${status.name}]` : ''
  const peopleStr = people.length > 0 ? ` @${people.map(p => p.name).join(', @')}` : ''
  return `${indent}${check} ${todo.title}${statusStr}${sched}${deadline}${peopleStr}`
}

function generatePlainText(
  sections: Section[],
  assignedPeopleMap: Map<number, Person[]>,
  statusMap: Map<number, Status>,
): string {
  const lines: string[] = []
  const today = startOfToday()

  for (const section of sections) {
    if (section.todos.length === 0) continue
    lines.push(`== ${section.label} ==`)
    const hierarchy = buildHierarchy(section.todos)
    for (const { parent, children } of hierarchy) {
      const people = assignedPeopleMap.get(parent.id) ?? []
      lines.push(formatTodoLine(parent, '  ', people, statusMap, today))
      for (const child of children) {
        const cp = assignedPeopleMap.get(child.id) ?? []
        lines.push(formatTodoLine(child, '    ', cp, statusMap, today))
      }
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

export function PlainTextExportPopup({ sections, assignedPeopleMap, statusMap, onClose }: PlainTextExportPopupProps) {
  const [copied, setCopied] = useState(false)
  const contentRef = useRef<HTMLPreElement>(null)

  const text = generatePlainText(sections, assignedPeopleMap, statusMap)

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
