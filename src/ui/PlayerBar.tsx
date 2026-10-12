import type { TraceStep } from '../engine'
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, RestartIcon } from './icons'
import type { Player, Speed } from './usePlayer'

const SPEEDS: Speed[] = [0.5, 1, 2]

interface Props {
  player: Player
  steps: TraceStep[] | null
}

export function PlayerBar({ player, steps }: Props) {
  const disabled = !steps
  return (
    <div className="player" role="region" aria-label="Reproductor">
      <div className="player-inner">
        <div className="player-controls">
          <button type="button" className="icon-btn" onClick={player.restart} disabled={disabled} aria-label="Reiniciar">
            <RestartIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={player.prev}
            disabled={disabled || !player.hasPrev}
            aria-label="Paso anterior"
          >
            <PrevIcon />
          </button>
          <button
            type="button"
            className={`icon-btn play-btn${!disabled && !player.playing && player.index === 0 ? ' is-next' : ''}`}
            onClick={player.toggle}
            disabled={disabled}
            aria-label={player.playing ? 'Pausar' : 'Reproducir'}
          >
            {player.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={player.next}
            disabled={disabled || !player.hasNext}
            aria-label="Paso siguiente"
          >
            <NextIcon />
          </button>
        </div>

        <div className="timeline" role="group" aria-label="Línea de tiempo">
          {steps?.map((step, i) =>
            player.isVisible(i) ? (
              <button
                key={i}
                type="button"
                className={`tick ${step.detail}${i < player.index ? ' passed' : ''}${i === player.index ? ' current' : ''}`}
                tabIndex={i === player.index ? 0 : -1}
                aria-label={`Paso ${i + 1}: ${step.title}`}
                aria-current={i === player.index ? 'step' : undefined}
                onClick={() => player.go(i)}
              >
                <span className="tick-bar" />
              </button>
            ) : null,
          )}
        </div>

        <div className="player-options">
          <div className="speed" role="group" aria-label="Velocidad">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className="speed-btn"
                aria-pressed={player.speed === s}
                onClick={() => player.setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={player.showMinor}
              onChange={(e) => player.setShowMinor(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            <span>Fila por fila</span>
          </label>
        </div>
      </div>
    </div>
  )
}
