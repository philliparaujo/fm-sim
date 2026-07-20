# FM Sim

## Demo

See the app live: https://philliparaujo.github.io/fm-sim/

Screenshots: TODO

## Description

FM Sim is a browser-based NFL simulation and management / roguelike game inspired by [Football Manager](https://en.wikipedia.org/wiki/Football_Manager). Draft from a randomly generated prospect pool, then manage a full season in an 8v8, 8-team league.

The draft is the first and most impactful part of the run as it defines your entire team, including the superstars, weak points, and ideal scheme. Each week you train players, tweak schemes, and spectate your team's matches. Games can be watched live play-by-play, witnessed through highlights, or simulated entirely. The league features a regular season and a 4-team playoff bracket to crown a champion, after which you can start a fresh run.

## Project Structure

The project is built with [TypeScript](https://www.typescriptlang.org/) and [Vite](https://vitejs.dev/), rendering to an HTML canvas with no external UI framework. There is no backend — everything runs client-side, including a Web Worker used to simulate league games in parallel.

- `src`
  - `behavior`: Per-role player decision logic during a live play
  - `core`: Game rules and state — draft, ratings, coverage, playbooks, schedule, training, awards, percentiles, stats
  - `render`: Canvas drawing for the field, players, ball, and traces
  - `sim`: Tick-based simulation engine, headless game runner, Web Worker, replay/highlight capture
  - `ui`: Screen and component logic for each tab (draft, schedule, stats, training, play)
  - `utils`: Generic helpers for field geometry, routes, rosters, math, and vectors
  - `app.ts`: Application entry point that wires up all UI modules
- `public/styles`: Per-tab CSS
- `index.html`: Static page shell, source for GitHub Pages demo
