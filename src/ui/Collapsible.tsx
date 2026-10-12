import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'

/** Estado booleano recordado en localStorage (tolerante a fallos de almacenamiento). */
export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw === null ? initial : raw === '1'
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        try {
          window.localStorage.setItem(key, resolved ? '1' : '0')
        } catch {
          // El almacenamiento puede no estar disponible; el estado sigue funcionando en memoria.
        }
        return resolved
      })
    },
    [key],
  )
  return [value, set]
}

interface Props {
  /** Identificador estable; tambien forma la clave de localStorage. */
  id: string
  title: string
  defaultOpen?: boolean
  /** Texto breve junto al titulo (por ejemplo un conteo). */
  meta?: ReactNode
  /** Fuerza el despliegue (por ejemplo, hay algo relevante en este paso). */
  forceOpen?: boolean
  /** Marca visible cuando esta plegado y hay algo relevante. */
  flag?: string
  className?: string
  headingLevel?: 2 | 3
  children: ReactNode
}

export function Collapsible({
  id,
  title,
  defaultOpen = true,
  meta,
  forceOpen = false,
  flag,
  className = 'side-section',
  headingLevel = 2,
  children,
}: Props) {
  const [stored, setStored] = useStoredFlag(`sqlteacher:collapse:${id}`, defaultOpen)
  const open = stored || forceOpen
  const Heading = headingLevel === 2 ? 'h2' : 'h3'

  return (
    <section className={className} aria-labelledby={`${id}-title`}>
      <Heading className="side-title collapsible-title" id={`${id}-title`}>
        <button
          type="button"
          className="collapsible-btn"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          aria-disabled={forceOpen || undefined}
          onClick={() => {
            if (!forceOpen) setStored((v) => !v)
          }}
        >
          <span className="chevron" aria-hidden="true" />
          <span className="collapsible-text">{title}</span>
          {meta !== undefined && <span className="collapsible-meta">{meta}</span>}
          {!open && flag && <span className="origin-tag">{flag}</span>}
        </button>
      </Heading>
      {open && <div id={`${id}-body`}>{children}</div>}
    </section>
  )
}
