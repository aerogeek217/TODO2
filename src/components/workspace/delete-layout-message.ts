/** The Delete layout confirm's body: what goes (the layout and its `ownedLists` lists), and what stays. */
export function deleteLayoutMessage(ownedLists: number): string {
  if (ownedLists === 0) return 'The layout is removed. Your tasks and notes are not affected.'
  const lists = ownedLists === 1 ? 'its list' : `its ${ownedLists} lists`
  return `The layout and ${lists} are removed. This can’t be undone. Your tasks and notes are not affected.`
}
