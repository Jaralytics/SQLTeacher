import { useCallback, useEffect, useState } from 'react'
import type { TraceStep } from '../engine'

export type Speed = 0.5 | 1 | 2

const MAJOR_MS = 1800
const MINOR_MS = 900

function isVisible(steps: TraceStep[], i: number, showMinor: boolean): boolean {
  return showMinor || steps[i].detail === 'major' || i === 0 || i === steps.length - 1
}

function findNext(steps: TraceStep[], from: number, showMinor: boolean): number {
  for (let i = from + 1; i < steps.length; i++) if (isVisible(steps, i, showMinor)) return i
  return -1
}

function findPrev(steps: TraceStep[], from: number, showMinor: boolean): number {
  for (let i = from - 1; i >= 0; i--) if (isVisible(steps, i, showMinor)) return i
  return -1
}

interface State {
  steps: TraceStep[] | null
  index: number
  playing: boolean
}

export function usePlayer(steps: TraceStep[] | null) {
  const [state, setState] = useState<State>({ steps, index: 0, playing: false })
  const [speed, setSpeed] = useState<Speed>(1)
  const [showMinor, setShowMinor] = useState(true)

  // Una traza nueva reinicia el reproductor, en pausa.
  let current = state
  if (state.steps !== steps) {
    current = { steps, index: 0, playing: false }
    setState(current)
  }
  const { index, playing } = current
  const count = steps?.length ?? 0

  useEffect(() => {
    if (!playing || !steps) return
    const base = steps[index].detail === 'major' ? MAJOR_MS : MINOR_MS
    const id = window.setTimeout(() => {
      const n = findNext(steps, index, showMinor)
      setState((s) => (n < 0 ? { ...s, playing: false } : { ...s, index: n }))
    }, base / speed)
    return () => window.clearTimeout(id)
  }, [playing, index, speed, showMinor, steps])

  const go = useCallback(
    (i: number) => setState((s) => (s.steps ? { ...s, index: Math.max(0, Math.min(i, s.steps.length - 1)) } : s)),
    [],
  )
  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), [])
  const restart = useCallback(() => setState((s) => ({ ...s, index: 0, playing: false })), [])

  const next = useCallback(() => {
    if (!steps) return
    const n = findNext(steps, index, showMinor)
    if (n >= 0) setState((s) => ({ ...s, index: n }))
  }, [steps, index, showMinor])

  const prev = useCallback(() => {
    if (!steps) return
    const p = findPrev(steps, index, showMinor)
    if (p >= 0) setState((s) => ({ ...s, index: p, playing: false }))
  }, [steps, index, showMinor])

  const toggle = useCallback(() => {
    if (!steps) return
    if (playing) return pause()
    const atEnd = findNext(steps, index, showMinor) < 0
    setState((s) => ({ ...s, index: atEnd ? 0 : s.index, playing: true }))
  }, [steps, index, playing, showMinor, pause])

  return {
    index,
    count,
    playing,
    speed,
    showMinor,
    hasNext: !!steps && findNext(steps, index, showMinor) >= 0,
    hasPrev: !!steps && findPrev(steps, index, showMinor) >= 0,
    isVisible: (i: number) => !!steps && isVisible(steps, i, showMinor),
    setSpeed,
    setShowMinor,
    go,
    next,
    prev,
    restart,
    toggle,
  }
}

export type Player = ReturnType<typeof usePlayer>
