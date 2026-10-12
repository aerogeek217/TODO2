import type { PersistedTodoItem } from '../../../models'

/**
 * The four tasks of the sample check-in email to "Marcus Chen" (sent
 * 2026-10-12) that every reply fixture here answers. Their uids give the refs
 * `0c4d8e17`, `b71e05d9`, `3f9a1c42` and `9e8d7c6b`. Last modified before the
 * send date, so nothing is stale.
 */
export function checkinSampleTasks(): PersistedTodoItem[] {
  const base = {
    isCompleted: false,
    createdAt: new Date(2026, 8, 1),
    modifiedAt: new Date(2026, 9, 10, 15, 30),
  }
  return [
    {
      ...base,
      id: 1,
      uid: '0c4d8e17-5b2a-4f1e-9c3d-7a6b5c4d3e2f',
      title: 'Answer Northwind’s security questionnaire',
      dueDate: new Date(2026, 9, 9),
      progress: 'half done',
      notes: 'Sections 4 and 7 still open.\nSam has the SOC 2 letter.',
      sortOrder: 1,
    },
    {
      ...base,
      id: 2,
      uid: 'b71e05d9-1111-4222-8333-444455556666',
      title: 'Review the staging load-test results',
      dueDate: new Date(2026, 9, 14),
      progress: '40%',
      sortOrder: 2,
    },
    {
      ...base,
      id: 3,
      uid: '3f9a1c42-aaaa-4bbb-8ccc-ddddeeeeffff',
      title: 'Draft the migration runbook',
      dueDate: new Date(2026, 9, 16),
      notes: [
        'Cover the cutover sequence, rollback steps and who is on call.',
        '- Link the existing **DB checklist**',
        '- Ask Nina about the [rollback window](https://example.com/runbook)',
        '- [ ] Dry run on staging',
      ].join('\n'),
      sortOrder: 3,
    },
    {
      ...base,
      id: 4,
      uid: '9e8d7c6b-5a49-4382-8716-a5b4c3d2e1f0',
      title: 'Renew the Contoso support contract — confirm pricing tier & seats (<50 users?)',
      nextFollowupAt: new Date(2026, 10, 1),
      sortOrder: 4,
    },
  ]
}
