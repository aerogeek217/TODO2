# Ambience

Ambience draws quiet signs of the time of day and the season in the chrome. It is never over a task's text and never in a color that means something. It is desktop only, on by default, and set in Settings › Appearance › Ambience. `hooks/use-ambience` computes the scene (`utils/sky`), and `components/ambience` draws it.

## The scene

- `hooks/use-ambience` computes the `utils/sky` scene once a minute from the clock and the place.
- The place is a typed latitude / longitude, else the time zone's main city (`utils/sun`).
- There is no location prompt and no network, so the offline file stays clean.

## What is drawn

In the top bar:

- the sky over the glass, at the share the glass lets through;
- the sun and moon as soft discs;
- stars: varied sizes, a few bright, a slow shallow twinkle;
- on some nights a steady evening planet;
- cumulus, the winter aurora, morning mist;
- the season's weather: snow, leaves, petals, seeds, fireflies (CSS-animated);
- the rare [sky events](#sky-events);
- the sun's point on the hairline.

In the workspace:

- the sunbeam behind the cells. No weather falls there: moving sprites behind the tasks distract;
- lamplight over the cells.

A task completed on screen sends a ripple along the hairline and a burst from its box.

The daytime things fade out through dusk and are gone by full night: the clouds, and the leaves, petals and seeds. Snow keeps falling; fireflies come out.

## Sky events

| Event | Gap | When |
|---|---|---|
| Shooting star | every 2–5 minutes | in the dark sky |
| UFO | every 1–2 hours | in the dark sky |
| Airplane | every 5–10 minutes | by day |

`utils/sky-events` + `hooks/use-sky-events` run them: timers, the motion in CSS. There are none under reduced motion or at Header motion 0.

## Settings

- Sky strength (the **Sky** setting) scales the sky, clouds, aurora, mist, sunbeam, stars, planet and sky events.
- **Header motion** scales everything that moves in the bar.
- **Seasons** governs the weather, the burst and the aurora.
- Reduced motion keeps a still sky.
- The settings are one JSON settings row (`ambience`).

## Colors

Its colors are `--ambience-*` tokens in `tokens.css`, each theme's own there. The scene mixes them by the time of day with `color-mix()`. No ambience file writes a color or picks one by theme.
