import type { KeyboardEvent } from 'react'

export interface SegmentItem<T extends string> {
  id: T
  label: string
}

interface Props<T extends string> {
  items: SegmentItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
  /** Prefijo para los ids de pestanas y paneles. */
  idPrefix: string
  className?: string
}

export function tabId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`
}

export function panelId(prefix: string): string {
  return `${prefix}-panel`
}

/** Pestanas accesibles (tablist) con navegacion por flechas. */
export function Segmented<T extends string>({ items, value, onChange, label, idPrefix, className = '' }: Props<T>) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = items.findIndex((x) => x.id === value)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    onChange(items[next].id)
    document.getElementById(tabId(idPrefix, items[next].id))?.focus()
  }

  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={tabId(idPrefix, item.id)}
          aria-selected={item.id === value}
          aria-controls={panelId(idPrefix)}
          tabIndex={item.id === value ? 0 : -1}
          className="segment"
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
