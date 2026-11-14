# Park Pro XUV

A browser-based 3D driving and parking trainer for the Mahindra XUV 7XO AX7 (diesel automatic), built with Vite, TypeScript, Three.js and Rapier. Runs fully client-side and deploys as a static site.

> **Status: Stage 4 of 7** — six training levels with scoring and stars, parking sensors, ideal-path and predicted-path guides, a ghost demo, tutorials with diagrams, and level, pause and result menus. Stage 3 delivered the lofted XUV 7XO body and right-hand-drive cabin, lamps and seven cameras. Stage 2 delivered the diesel automatic drivetrain, EPB and auto-hold, engine sound and the photographic look.

## Levels

| # | Level | What you practise |
|---|---|---|
| 1 | Practice lot | Free driving: selector, creep, braking, turning circle |
| 2 | Cone course | Slalom, U-turn and reverse through gates; cones can be knocked over |
| 3 | Forward bay parking (90°) | Driving nose-first into a bay between parked cars |
| 4 | Reverse bay parking (90°) | Reversing into a bay using mirrors and the rear camera |
| 5 | Angled parking (45°) | Entering a 45° bay from a narrow aisle |
| 6 | Parallel parking | Reversing into a kerbside gap, finishing close to the kerb |

Levels 1 and 2 are always open; each later level unlocks when the previous one has at least one star. The level menu has a switch to open all levels.

**Difficulty** (picked in the level menu, default Normal): Beginner has wider bays and gaps, looser angle and kerb tolerances, and all assists on. Hard has the tightest spaces and turns assists off. The ideal path in every level is solved from the car's real turning circle and checked by the tests to clear every obstacle at every difficulty.

**Finishing:** a parking level finishes when the car is inside the target bay, within the angle tolerance (and, for parallel parking, close enough to the kerb), stopped, and in P or with the EPB on. The cone course finishes at the last gate.

**Scoring:** you start from 100 points and lose points for time over par, extra direction changes beyond the ideal manoeuvre, collisions, knocked cones, kerb touches and poor alignment. 85 points or more earns 3 stars and 65 or more earns 2; anything else earns 1. Using "Reset to last stop" limits the result to 2 stars. Best scores are saved per level and difficulty in the browser (localStorage).

## Learning aids

- **Parking sensors:** eight sensors (front and rear, centre and corners) are active in R, and in D below 12 km/h. The display shows the nearest obstacle in colour zones, and the beeps speed up from 1.5 m to a continuous tone under 0.3 m.
- **Ideal path:** a ribbon on the ground (blue forward, amber reverse) with white car outlines where you change direction and where you finish. On-screen hints follow your progress along it.
- **Predicted path:** the path of the bumper corners for the current steering angle.
- **Ghost demo:** a translucent car drives the ideal manoeuvre ("Watch the ideal manoeuvre" in the tutorial, pause and result menus; `Esc` stops it).
- **Eon outline:** the footprint of the Maruti Eon shown inside the XUV's, for comparing sizes.
- **Automatic rear camera:** shows the rear-camera view while reversing.
- **Slow motion** (×0.35), **pause** with free-look orbit, **retry**, and **reset to the last place you stopped**.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Headless vehicle-physics tests (Vitest, Node) |
| `npm run typecheck` | TypeScript only |

## Deploy to GitHub Pages

1. Push this project to a GitHub repository with `main` as the default branch.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` runs the tests, builds, and publishes `dist/`.

The Vite `base` is `./`, so the site works from any `https://<user>.github.io/<repo>/` path.

## Controls

| Action | Keys |
|---|---|
| Engine start / stop (selector in P or N) | `I` |
| Selector towards D (P → R → N → D), hold the brake | `E` / `X` |
| Selector towards P (D → N → R → P), hold the brake | `Q` / `Z` |
| Accelerator / brake pedal | `W` `↑` / `S` `↓` (hold `Shift` for gentle pedal) |
| Steer left / right | `A` `D` / `←` `→` |
| Electronic parking brake (EPB) | `Space` |
| Auto-hold on / off | `B` |
| Left / right indicator, hazards | `,` / `.` , `/` |
| Headlights | `L` |
| Ideal path and hints on / off | `G` |
| Eon outline on / off | `O` |
| Automatic rear camera on / off | `V` |
| Slow motion on / off | `T` |
| Reset to the last place you stopped | `K` |
| Retry level | `R` / `Backspace` |
| Next camera / pick camera | `C` / `1`–`7` |
| Look around (driver, bonnet) or orbit | drag with the mouse |
| Zoom (top-down, 360°, orbit) | mouse wheel |
| Door-mirror views: off → cabin cameras → all cameras (cycles) | `M` |
| Horn | `H` |
| Pause menu | `Esc` / `P` |

In menus, `Enter` presses the main button and `Esc` goes back.

Driving like the real car: the car starts in P with the EPB on. Press `I`, hold `S`, shift to D with `E` (×3) or R (×1), then release the brake — the car creeps. Pressing `W` releases the EPB automatically when the selector is in D or R. P and R refuse to engage while moving, and every shift out of P needs the brake held. Sound starts on your first key press or click (browser autoplay rule).

## Cameras

| Key | Camera |
|---|---|
| `1` | Chase |
| `2` | Driver's seat (right-hand drive; the look springs back to the road after you let go) |
| `3` | Bonnet |
| `4` | Top-down parking view (turns with the car) |
| `5` | Orbit |
| `6` | Rear camera, full screen |
| `7` | 360° overhead view (shows the guidelines while in R) |

In R, the reverse camera also appears as a picture-in-picture view at the top of the screen (switch with `V`). Like the real display it is mirrored, and the guidelines are the predicted path of the rear bumper corners for the current steering angle, with marks at 0.5 m (red), 1 m and 2 m. In the driver's view the interior rear-view mirror shows a live image, and the door mirrors appear as picture-in-picture views. The last camera you used is remembered.

## Graphics quality

The preset is picked automatically (High on desktop, Medium on touch devices). Override with the URL parameter `?quality=low|medium|high`:

| Preset | Pixel ratio cap | Shadow map | MSAA | Ambient occlusion | Bloom |
|---|---|---|---|---|---|
| `low` | 1 | 1024 | browser AA | off | off |
| `medium` | 1.5 | 2048 | 4× | off | on |
| `high` | 2 | 4096 | 4× | on | on |

`?paint=0..5` picks the paint colour (Everest White, Napoli Black, Dazzling Silver, Red Rage, Deep Forest, Electric Blue).

## Assets and credits

All textures and the sky HDRI are CC0 from [Poly Haven](https://polyhaven.com/) (sky: *Kloofendal 48d Partly Cloudy (Pure Sky)*), converted to WebP and stored in `public/assets/`. To re-download or change them, run `python3 scripts/fetch-assets.py`.

## Project layout

```
src/
  config.ts            Vehicle dimensions + physics tuning (single place to tweak)
  main.ts              Boot + lazy-load of the game chunk
  core/                Game loop, renderer, post-processing, quality presets, asset loading, Rapier bootstrap
  vehicle/             VehiclePhysics (Rapier raycast vehicle), Drivetrain, steering, lights, lofted body, exterior details, cabin, wheels
  audio/               Procedural diesel engine (AudioWorklet), horn, indicator tick, reverse and parking-sensor beeps, collision and kerb sounds
  levels/              Level definitions, ideal-path solver and validation, parking evaluation, scoring, level session, guide visuals
  world/               Base ground, level props (markings, kerbs, walls, cones), instanced parked cars, PBR surface material
  cameras/             Camera rig (7 modes), picture-in-picture views (reverse camera, mirrors), interior mirror, reverse guidelines
  input/               InputState (device-agnostic) + keyboard and mouse sources
  ui/                  HUD, menus, level diagrams
tests/                 Headless physics, level, sensor and manoeuvre tests
```

## Tuning the car physics

Everything lives in `src/config.ts`:

- `XUV_7XO` — real-world dimensions. `turningRadiusM` drives the full-lock steering angle: the Ackermann geometry in `src/vehicle/steering.ts` is solved so the outer front wheel traces exactly this radius.
- `XUV_TUNING.suspension` — rest length, travel, stiffness and damping (Rapier scales stiffness by chassis mass).
- `XUV_TUNING.tyre` — `frictionSlip` is roughly the tyre grip coefficient; lower values give earlier understeer and lock-up.
- `XUV_TUNING.steering` — how fast the wheel winds to lock, self-centring, and the speed-sensitive lock reduction.
- `XUV_TUNING.brakes` / `pedals` / `resistance` — brake force and bias, EPB and park-pawl holding force, pedal ramp rates, aero drag and rolling resistance.
- `XUV_DRIVETRAIN` — engine torque curve, idle governor and friction; torque-converter capacity, stall ratio and lock-up; gear ratios, final drive and the shift schedule (upshift/downshift rpm at light and full throttle).

After changing values, run `npm test`. The tests check the turning circle (about 5.4 m), braking distance from 80 km/h (23–36 m), creep speed in D (5–9 km/h), 0–100 km/h (9–13 s through at least four gears), selector interlocks, idle rpm, and a 120 km/h cruise in 6th with the converter locked. Level tests check that every ideal path ends parked within tolerance and clears all obstacles, and that the physics car can drive the Level 4 and 6 paths and park.
