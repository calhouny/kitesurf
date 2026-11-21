# Kite Rush: Big Air

A 3D arcade & physics kitesurfing game built with **Vite**, **TypeScript**, **Three.js**, and procedural **Web Audio API** sound synthesis. Carve across real-time 4-octave Gerstner swells, park your kite in the wind window, boost 20m–40m+ Big Air off wave lips and kicker ramps, pull wide sweeping kiteloops, and chain grabs and rolls up to a 10x multiplier.

For a visual Wind Window diagram, full technique breakdown, and interactive reference guide, see **[how-to-play.html](./how-to-play.html)** (opens directly in any browser or at `/how-to-play.html` when running `npm run dev`).

---

## Highlights

- **Synchronized GPU/CPU Gerstner Ocean (`OceanSystem` & `ParticleSystem`)**: Custom GLSL 4-octave Gerstner wave shader with Fresnel sky reflection, subsurface turquoise crest scattering, specular sun glints, and foam caps, paired with a 3-step Newton-Raphson CPU solver so the twin-tip board rides the exact visual waves. Includes a golden-hour sky dome, distant volcanic horizon islands, animated 3D wind streaks, V-shaped water wakes, rail spray, jump/landing splash bursts, and wingtip ribbons.
- **Authentic Quarter-Sphere Wind-Window Physics (`KitePhysicsEngine`)**:
  - **12 O'Clock Overhead Lull**: Parking the kite overhead (`az ≈ 0°`, `el >= 78°`) drops forward propulsion to an idle drift; diving or lowering the kite below `~75°` builds line tension and accelerates to `30+ kts` planing speed.
  - **Free Ride Default (`autoAssist = false`) & Course Pull Helper**: Out of the box, steering a kite to either side settles naturally in the `35°–40°` sweet-spot pocket for sustained `80°–90°` crosswind tacking (`38°` idle parking). Toggle **Course Pull (`COURSE PULL: ON`)** at any time from the Title Screen, top HUD, or Pause menu for assisted corridor steering.
  - **Gradual Gradient Steering Momentum**: Smooth bar-pressure buildup (`steerHoldBlend`) and kite-driven rider heading so the surfer carves into the kite's pull naturally without abrupt snapping.
  - **Wide Sweeping Kiteloops & Airborne Pendulum**: Pressing `Space` (or `Shift`/`E`) mid-air sends the kite through a wide circular sweep (`±38°` azimuth, leading edge pointed into the dive) for a brief forward yank and gentle descent catch without infinite altitude climbing. With an off-center kite in the air, gravity swings the rider like a pendulum underneath the kite fulcrum.
- **4 Game Modes & Endless Ocean World (`WorldManager`)**:
  - **King of the Air (`BIG_AIR`)** — 90-second Big Air heat (`17.5 m/s` / `~34 kts` storm wind).
  - **Endless Ocean (`ENDLESS`)** — Open-ended free-ride session across infinite chunked swells.
  - **Freestyle Jam (`FREESTYLE`)** — 90-second trick combo jam (`15.5 m/s`).
  - **Slalom Course (`SLALOM`)** — 90-second alternating red/green buoy gate race (`16.0 m/s`).
  - Dynamic lateral/forward world streaming spawns kicker ramps, aerial sky-rings, thermal wind gusts, slalom buoy gates, golden kite-coins, floating barrels, and patrolling shark fins.
- **7 Unlockable Rigs & 8 Season Missions (`GEAR_CATALOG`, `MISSIONS_CATALOG`, `SaveManager`)**: Unlock and equip kites and twin-tip boards (`Tradewind Classic` through `King of the Air Apex`) with additive boost, turn-speed, and hangtime bonuses, plus persistent `localStorage` records.
- **Procedural Audio & Independent Music Bus (`AudioEngine`)**: Zero external audio files — dynamic rushing wind/dive whooshes, water carving hull hiss with silent-air cutoffs at altitude, synthesized SFX, and an optional procedural tropical synthwave soundtrack (`Music` bus routes independently from `SFX` mute across Title Screen, Pause Menu, and gameplay).
- **4 Camera Presets & Responsive Controls (`InputManager`, `UIManager`)**: Cycle `CHASE -> POV (First-Person) -> PRO -> HELI` with dynamic speed/air FOV scaling and damped screen shake. Full desktop keyboard and automatic mobile dual-thumb touch controls (`<= 900px` or touch input).

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the Vite development server (http://localhost:5173)
npm run dev

# 3. Type-check and build the production bundle
npm run build

# 4. Preview the production build locally
npm run preview
```

- Open the game at `http://localhost:5173/` when `npm run dev` is running.
- Open the illustrated guide directly via **[how-to-play.html](./how-to-play.html)** (`file://`) or at `http://localhost:5173/how-to-play.html`.

---

## Controls

| Action | Desktop Keyboard | Mobile / Touch |
| --- | --- | --- |
| Steer kite left / right (carve & tack) | `A` / `D` or `←` / `→` | Left virtual thumbstick (X axis) |
| Sheet bar in / out (raise toward 12 o'clock / depower) | `W` / `S` or `↑` / `↓` | Left virtual thumbstick (Y axis) |
| Pop / Big Air jump (on water) | `Space` | `JUMP` button |
| Wide sweeping Kiteloop (in mid-air) | `Space` (airborne), `Shift`, or `E` | `LOOP` button |
| Backroll / Frontroll (mid-air) | `J` / `L` or `1` / `3` | Trick pad Left / Right |
| Board-Off → Superman (hold) | `I` or `2` (combine `J`/`L` + `I` for Superman) | Trick pad Up |
| Indy Grab → Handlepass (hold) | `K` or `4` (combine `J`/`L` + `K` for Handlepass) | Trick pad Down |
| Cycle camera (`CHASE` / `POV` / `PRO` / `HELI`) | `C` or HUD Camera button | HUD Camera button |
| Pause / Resume | `P` or `Esc` or HUD Pause button | HUD Pause button |

---

## Game Modes & Wind Physics Overview

1. **Wind Window & Crosswind Tacking**: Wind blows downwind toward `-Z`, placing the quarter-sphere wind window (`azimuth` `-85°..+85°`, `elevation` `10°..88°`) ahead of the rider. Parking the kite out to either side (`~35°–40°` elevation) sustains fast `80°–90°` crosswind reaches in **Free Ride** mode (`FREE RIDE: ON`), while steering back inward lifts the kite toward 12 o'clock to transition tacks or slow down in the overhead lull.
2. **Big Air Launches**: Carve across a swell or hit a kicker ramp while sheeting in (`W`/`Up`) and sending the kite toward 12 o'clock, then press `Space` to convert line tension and board speed into `15m–40m+` jumps tracked live on the Big Air Altimeter.
3. **Kiteloops, Tricks & Clean Landings**: Trigger `Space` (or `Shift`/`E`) once airborne to sweep the kite through a circular power-zone loop, chain rotations (`360`/`720`+ Backrolls & Frontrolls) and grabs (`Indy Grab`, `Board-Off`, `Superman`, `Handlepass`) to climb up to a `10x` combo multiplier, and align the board cleanly for a landing speed boost (bad board angles, very high-impact slams, low-altitude kiteloop impacts, barrels, and shark fins trigger quick-recovery wipeouts).

---

## Architecture & Project Structure

```text
/Users/cal/Dev/kitesurf/
├── index.html          # Main WebGL game entry shell (#app mount)
├── how-to-play.html    # Standalone responsive How to Play guide + SVG wind window diagram
├── package.json        # Scripts (dev, build, preview) & dependencies (three, vite, typescript)
├── tsconfig.json       # Strict TypeScript (ES2022, bundler moduleResolution)
├── vite.config.ts      # Vite build & dev server configuration
└── src/
    ├── main.ts         # KiteRushGame loop, state machine, 4-preset camera rig, subsystem wiring
    ├── types.ts        # Shared TypeScript contracts (PhysicsState, InputState, KiteGear, etc.)
    ├── style.css       # Full-viewport reset & canvas container styling
    ├── ocean.ts        # OceanSystem: GLSL 4-octave Gerstner ocean, sky dome, islands, wind streaks
    ├── particles.ts    # ParticleSystem: rail spray, V-wake trail, splash bursts, wingtip ribbons
    ├── physics.ts      # KitePhysicsEngine: wind-window aerodynamics, Free Ride/Course Pull, kiteloops, pendulum
    ├── rider.ts        # RiderAndKiteRig: articulated surfer, twin-tip board, C/SLE kite, 4 flying lines
    ├── tricks.ts       # TrickSystem: rotations, grabs/poses, kiteloop grading, 10x combo multiplier
    ├── world.ts        # WorldManager: lateral/forward procedural chunks, ramps, rings, buoys, gusts, coins, hazards
    ├── gear.ts         # GEAR_CATALOG (7 rigs), MISSIONS_CATALOG (8 missions), SaveManager (localStorage)
    ├── audio.ts        # AudioEngine: Web Audio rushing wind, water hiss, silent-air, SFX, independent music bus
    ├── input.ts        # InputManager: keyboard + responsive dual-thumb touch controls & autoAssist state
    └── ui.ts           # UIManager: HUD, Big Air Altimeter, Wind Window dome, Title Screen, Gear Shop, Modals
```

### Tech Stack

- **Vite** (`^8.3.8`) — Fast HMR dev server and ES2022 production bundler
- **TypeScript** (`^7.0.2`) — Strict type-checking across shared game contracts (`tsc --noEmit`)
- **Three.js** (`^0.187.0`) — Custom GLSL ocean/sky shaders, shadow-mapped 3D rig, procedural world chunks
- **Web Audio API** — Zero-asset procedural sound synthesis and scheduled tropical synthwave music
