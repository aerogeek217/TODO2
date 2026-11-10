import { useMemo, useState, type KeyboardEvent } from 'react'
import { useSettingsStore } from '../../../stores/settings-store'
import { SKY_STRENGTHS, SKY_STRENGTH_LABELS, type AmbiencePlace } from '../../../models/ambience'
import { roundCoordinate } from '../../../utils/ambience-settings'
import { guessPlace, sunDay } from '../../../utils/sun'
import { SettingRow } from './SettingRow'
import styles from './sections.module.css'
import own from './AmbienceSection.module.css'

/** A clock time of `hours` today, in the browser's own format (`6:33 AM`, `06:33`). */
function clockTime(hours: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setMinutes(Math.round(hours * 60))
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** `41.88` / `-87.63`: a coordinate as typed back into its field. */
function coordinateText(v: number): string {
  return roundCoordinate(v).toFixed(2)
}

/** A typed coordinate (a minus or a `−`), or `null` when it isn't a number within `max`. */
function readCoordinate(text: string, max: number): number | null {
  const t = text.trim().replace('−', '-')
  if (t === '') return null
  const v = Number(t)
  return Number.isFinite(v) && Math.abs(v) <= max ? v : null
}

/** Today's sunrise and sunset at `place`, as a line. */
function sunLine(place: AmbiencePlace): string {
  const day = sunDay(new Date(), place)
  if (day.polar === 'day') return 'The sun doesn’t set there today.'
  if (day.polar === 'night') return 'The sun doesn’t rise there today.'
  return `Today the sun rises at ${clockTime(day.rise)} and sets at ${clockTime(day.set)}.`
}

/** Where the sun comes from: a latitude and longitude, first guessed from the time zone. */
function PlaceRow() {
  const stored = useSettingsStore((s) => s.ambience.place)
  const setAmbience = useSettingsStore((s) => s.setAmbience)
  const guess = useMemo(() => guessPlace(), [])
  const shown = stored ?? guess
  const shownText = `${coordinateText(shown.lat)},${coordinateText(shown.lon)}`
  const [lat, setLat] = useState(coordinateText(shown.lat))
  const [lon, setLon] = useState(coordinateText(shown.lon))
  // A saved place (or the guess again) shows in the fields.
  const [syncedFrom, setSyncedFrom] = useState(shownText)
  if (shownText !== syncedFrom) {
    setSyncedFrom(shownText)
    setLat(coordinateText(shown.lat))
    setLon(coordinateText(shown.lon))
  }

  const latValue = readCoordinate(lat, 90)
  const lonValue = readCoordinate(lon, 180)
  const valid = latValue !== null && lonValue !== null

  function commit() {
    if (latValue === null || lonValue === null) return
    const place = { lat: roundCoordinate(latValue), lon: roundCoordinate(lonValue) }
    if (place.lat === roundCoordinate(shown.lat) && place.lon === roundCoordinate(shown.lon)) return
    void setAmbience({ place })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur()
    // Esc puts back what is saved and stays in Settings; with nothing to put back it closes the modal.
    if (e.key === 'Escape' && (lat !== coordinateText(shown.lat) || lon !== coordinateText(shown.lon))) {
      e.preventDefault()
      e.stopPropagation()
      setLat(coordinateText(shown.lat))
      setLon(coordinateText(shown.lon))
    }
  }

  const guessed = stored === null
  const status = !valid
    ? null
    : `${guessed ? (guess.name ? `Guessed from your time zone (${guess.name}). ` : 'Guessed from your time zone. ') : ''}${sunLine(shown)}`

  return (
    <SettingRow
      label="Place"
      help="Where the sun and the seasons come from, in degrees: south and west are negative. South of the equator the seasons flip. Two decimals is plenty."
      column
    >
      <div className={own.placeLine}>
        <label className={own.field}>
          Latitude
          <input
            className={`${styles.input} ${own.coordinate}`}
            inputMode="decimal"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            aria-invalid={latValue === null}
            autoComplete="off"
          />
        </label>
        <label className={own.field}>
          Longitude
          <input
            className={`${styles.input} ${own.coordinate}`}
            inputMode="decimal"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            onBlur={commit}
            onKeyDown={onKeyDown}
            aria-invalid={lonValue === null}
            autoComplete="off"
          />
        </label>
        {!guessed && (
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => void setAmbience({ place: null })}>
            Use time zone guess
          </button>
        )}
      </div>
      {valid
        ? <span className={styles.muted}>{status}</span>
        : <span className={styles.errorMsg} role="alert">Latitude runs from −90 to 90 and longitude from −180 to 180. Nothing changed.</span>}
    </SettingRow>
  )
}

/** Settings › Appearance › Ambience (desktop only): the switch, Place, Sky, Header motion and Seasons. */
export function AmbienceSection() {
  const ambience = useSettingsStore((s) => s.ambience)
  const setAmbience = useSettingsStore((s) => s.setAmbience)
  // The slider shows its own value at once; a saved change from elsewhere (an undo) moves it.
  const [motion, setMotion] = useState(ambience.motion)
  const [motionFrom, setMotionFrom] = useState(ambience.motion)
  if (ambience.motion !== motionFrom) {
    setMotionFrom(ambience.motion)
    setMotion(ambience.motion)
  }

  return (
    <div className={styles.section}>
      <SettingRow label="Ambience" help="The sky, the sun and the moon, and the season's weather in the top bar and around your lists.">
        <button
          type="button"
          role="switch"
          aria-checked={ambience.enabled}
          aria-label="Ambience"
          className={`${styles.switch} ${ambience.enabled ? styles.switchOn : ''}`}
          onClick={() => void setAmbience({ enabled: !ambience.enabled })}
        />
      </SettingRow>
      <div className={ambience.enabled ? own.rows : `${own.rows} ${own.rowsOff}`}>
        <PlaceRow />
        <SettingRow label="Sky" help="How strongly the sky shows through the top bar's glass, and how visible the clouds, mist, aurora and sunbeam are.">
          <div className={styles.segmented} role="radiogroup" aria-label="Sky">
            {SKY_STRENGTHS.map((sky) => (
              <button
                key={sky}
                type="button"
                role="radio"
                aria-checked={ambience.sky === sky}
                className={`${styles.segment} ${ambience.sky === sky ? styles.segmentActive : ''}`}
                onClick={() => void setAmbience({ sky })}
              >
                {SKY_STRENGTH_LABELS[sky]}
              </button>
            ))}
          </div>
        </SettingRow>
        <SettingRow label="Header motion" help="How visible the moving things in the top bar are: the sun and the moon, stars, clouds, weather. At 0% the sky still follows the clock but nothing moves.">
          <input
            type="range"
            className={own.slider}
            min={0}
            max={100}
            step={5}
            value={motion}
            aria-label="Header motion"
            aria-valuetext={`${motion}%`}
            onChange={(e) => {
              const v = Number(e.target.value)
              setMotion(v)
              void setAmbience({ motion: v }, { mergeKey: 'ambience-motion' })
            }}
          />
          <output className={own.sliderValue}>{motion}%</output>
        </SettingRow>
        <SettingRow label="Seasons" help="Weather in the top bar, the season in the checkmark when you complete a task, and the aurora on winter nights.">
          <button
            type="button"
            role="switch"
            aria-checked={ambience.seasons}
            aria-label="Seasons"
            className={`${styles.switch} ${ambience.seasons ? styles.switchOn : ''}`}
            onClick={() => void setAmbience({ seasons: !ambience.seasons })}
          />
        </SettingRow>
      </div>
    </div>
  )
}
