/** Whether `v` is one of `list`'s values — a guard that narrows an unknown to the list's type (the models' readers of untrusted input). */
export function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}
