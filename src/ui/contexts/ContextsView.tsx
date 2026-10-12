import { useState } from 'react'
import './contexts.css'
import { JoinLesson } from './JoinLesson'
import { NullLesson } from './NullLesson'
import { OrderLesson } from './OrderLesson'
import { Segmented } from './Segmented'

type Lesson = 'join' | 'orden' | 'null'

const LESSONS = [
  { id: 'join' as const, label: 'Tipos de JOIN' },
  { id: 'orden' as const, label: 'Orden lógico de ejecución' },
  { id: 'null' as const, label: 'NULL y agregados' },
]

interface Props {
  /** Carga la consulta en el editor del reproductor, la ejecuta y cambia de vista. */
  onOpenInPlayer: (formula: string) => void
}

const PREFIX = 'lesson'

export function ContextsView({ onOpenInPlayer }: Props) {
  const [lesson, setLesson] = useState<Lesson>('join')

  return (
    <div className="contexts">
      <Segmented items={LESSONS} value={lesson} onChange={setLesson} label="Lecciones" idPrefix={PREFIX} />
      {lesson === 'join' && <JoinLesson idPrefix={PREFIX} onOpenInPlayer={onOpenInPlayer} />}
      {lesson === 'orden' && <OrderLesson idPrefix={PREFIX} onOpenInPlayer={onOpenInPlayer} />}
      {lesson === 'null' && <NullLesson idPrefix={PREFIX} onOpenInPlayer={onOpenInPlayer} />}
    </div>
  )
}
