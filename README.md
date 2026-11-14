# Park Pro XUV

A browser-based 3D driving and parking trainer for the Mahindra XUV 7XO AX7 (diesel automatic), built with Vite, TypeScript, Three.js and Rapier. Runs fully client-side and deploys as a static site.

> **Status: Stage 1 of 7** — project setup, fixed-timestep physics world, and a correctly sized (placeholder-looking) XUV you can drive with the keyboard on a flat practice ground.

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

## Controls (Stage 1)

| Action | Keys |
|---|---|
| Accelerate | `W` / `↑` |
| Brake (hold at standstill to engage reverse) | `S` / `↓` |
| Steer left / right | `A` `D` / `←` `→` |
| Handbrake | `Space` |
| Reset car | `R` |
| Pause | `Esc` / `P` |

In reverse, `S`/`↓` drives backwards and `W`/`↑` brakes; holding `W` at a standstill returns to D. The full P/R/N/D selector, creep and engine sound arrive in Stage 2.

## Project layout

```
src/
  config.ts            Vehicle dimensions + physics tuning (single place to tweak)
  main.ts              Boot + lazy-load of the game chunk
  core/                Game loop, renderer, Rapier bootstrap
  vehicle/             VehiclePhysics (Rapier raycast vehicle), steering geometry, visual
  world/               Practice ground (instanced markings, kerbs, cones, pillars)
  cameras/             Chase camera
  input/               InputState (device-agnostic) + keyboard source
  ui/                  HUD
tests/                 Headless physics tests
```

## Tuning the car physics

Everything lives in `src/config.ts`:

- `XUV_7XO` — real-world dimensions. `turningRadiusM` drives the full-lock steering angle: the Ackermann geometry in `src/vehicle/steering.ts` is solved so the outer front wheel traces exactly this radius.
- `XUV_TUNING.suspension` — rest length, travel, stiffness and damping (Rapier scales stiffness by chassis mass).
- `XUV_TUNING.tyre` — `frictionSlip` is roughly the tyre grip coefficient; lower values give earlier understeer and lock-up.
- `XUV_TUNING.steering` — how fast the wheel winds to lock, self-centring, and the speed-sensitive lock reduction.
- `XUV_TUNING.drive` / `brakes` / `resistance` — tractive force, wheel power, reverse limit, brake force and bias, aero drag and rolling resistance.

After changing values, run `npm test`. The tests check the turning circle (about 5.4 m), 0–100 km/h time (8–14 s), braking distance from 80 km/h (23–36 m), and that reverse is speed-limited.
