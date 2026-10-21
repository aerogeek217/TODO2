import { usePersonStore } from '../stores/person-store'
import { useTagStore } from '../stores/tag-store'

/**
 * A picked create row of the `@` / `#` popup: the person (`getOrCreate`) or
 * tag (`add`) is made at once, on every surface (Quick Add, the task
 * editor's title, notes), so the token the pick wrote then resolves to it
 * exactly. Lookup-or-create by name, ignoring case. A failure rejects with a
 * message meant for the user.
 */
export async function createNlpEntity(trigger: '@' | '#', name: string): Promise<void> {
  try {
    await (trigger === '@' ? usePersonStore.getState().getOrCreate(name) : useTagStore.getState().add(name))
  } catch (err: unknown) {
    throw new Error(`Couldn't create ${trigger}${name}`, { cause: err })
  }
}
