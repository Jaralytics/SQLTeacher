import type { Example } from '../engine'

interface Props {
  examples: Example[]
  selectedId: string | null
  onSelect: (example: Example) => void
}

export function ExamplePicker({ examples, selectedId, onSelect }: Props) {
  const topics = Array.from(new Set(examples.map((e) => e.topic)))
  const selected = examples.find((e) => e.id === selectedId)

  return (
    <div className="example-picker">
      <label htmlFor="example-select">Ejemplos</label>
      <select
        id="example-select"
        value={selected ? selected.id : ''}
        onChange={(ev) => {
          const ex = examples.find((e) => e.id === ev.target.value)
          if (ex) onSelect(ex)
        }}
      >
        <option value="" disabled>
          Elegir un ejemplo
        </option>
        {topics.map((topic) => (
          <optgroup key={topic} label={topic}>
            {examples
              .filter((e) => e.topic === topic)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
