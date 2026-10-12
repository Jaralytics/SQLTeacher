import { useEffect, useState } from 'react'

export interface Ghosted<T> {
  item: T
  /** true mientras el elemento ya no existe en los datos pero se anima su salida. */
  leaving: boolean
}

function merge<T>(
  previous: Ghosted<T>[],
  next: T[],
  getKey: (item: T) => string,
): Ghosted<T>[] {
  const result: Ghosted<T>[] = next.map((item) => ({ item, leaving: false }))
  const present = new Set(next.map(getKey))
  previous.forEach((entry, index) => {
    if (present.has(getKey(entry.item))) return
    let at = 0
    for (let j = index - 1; j >= 0; j--) {
      const k = getKey(previous[j].item)
      const found = result.findIndex((r) => getKey(r.item) === k)
      if (found >= 0) {
        at = found + 1
        break
      }
    }
    result.splice(at, 0, { item: entry.item, leaving: true })
  })
  return result
}

/**
 * Devuelve la lista actual mas los elementos que acaban de desaparecer, marcados
 * como `leaving`, para poder animar su salida antes de quitarlos del DOM.
 * `items` debe tener identidad estable entre renders si no cambia.
 */
export function useGhosts<T>(items: T[], getKey: (item: T) => string, ms = 380): Ghosted<T>[] {
  const [state, setState] = useState<{ items: T[]; merged: Ghosted<T>[] }>(() => ({
    items,
    merged: items.map((item) => ({ item, leaving: false })),
  }))

  let current = state
  if (state.items !== items) {
    current = { items, merged: merge(state.merged, items, getKey) }
    setState(current)
  }

  const hasLeaving = current.merged.some((m) => m.leaving)
  useEffect(() => {
    if (!hasLeaving) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const id = window.setTimeout(
      () =>
        setState((s) => ({ items: s.items, merged: s.merged.filter((m) => !m.leaving) })),
      reduced ? 0 : ms,
    )
    return () => window.clearTimeout(id)
  }, [hasLeaving, current.merged, ms])

  return current.merged
}
