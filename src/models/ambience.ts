/**
 * Ambience (Settings › Appearance › Ambience; desktop only): quiet signs of
 * the time of day and the season in the app's chrome — the top bar, its
 * hairline, the space around the cells. Purely cosmetic: nothing it draws
 * carries meaning, and it never draws over a task's text.
 */

/** How strongly the sky (and the clouds, aurora, mist and sunbeam) show. */
export type SkyStrength = 'whisper' | 'subtle' | 'vivid'

export const SKY_STRENGTHS: readonly SkyStrength[] = ['whisper', 'subtle', 'vivid']

export const SKY_STRENGTH_LABELS: Readonly<Record<SkyStrength, string>> = {
  whisper: 'Whisper',
  subtle: 'Subtle',
  vivid: 'Vivid',
}

/** Where the sun and the seasons come from: degrees, south and west negative. */
export interface AmbiencePlace {
  lat: number
  lon: number
}

export interface AmbienceSettings {
  /** Ambience at all (on by default). */
  enabled: boolean
  /** The place typed in Settings; `null` = guessed from the time zone. */
  place: AmbiencePlace | null
  sky: SkyStrength
  /** Header motion: how visible the moving things in the top bar are, 0–100 (%). */
  motion: number
  /** Weather in the bar and behind the cells, the season in the checkmark and the winter aurora. */
  seasons: boolean
}

export const DEFAULT_AMBIENCE: AmbienceSettings = {
  enabled: true,
  place: null,
  sky: 'whisper',
  motion: 40,
  seasons: true,
}

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

/** What falls in the bar (and behind the cells) — the season's, and the summer's by day or night. */
export type WeatherKind = 'flake' | 'leaf' | 'petal' | 'seed' | 'firefly'
