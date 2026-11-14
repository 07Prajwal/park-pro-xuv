---
artifact: spec
artifact_schema_version: 1
---

# Park Pro XUV - Stage 2 automatic drivetrain, engine audio and realistic rendering — Specification

## Working Description

Replace the Stage 1 arcade drive model with a physically motivated diesel automatic: 2.2 L diesel torque curve with idle governor and rev limiter, torque converter (creep at idle, stall, lock-up), 6-speed automatic with shift schedule and kickdown, P/R/N/D selector with real interlocks, park pawl, EPB and auto-hold. Add procedural WebAudio engine sound and car sounds. At the same time, lift the rendering to a realistic look: HDRI sky with image-based lighting, filmic tone mapping, photo-scanned PBR textures, MSAA, ambient occlusion and bloom on High quality, and a smooth bevelled car body with clearcoat paint and realistic wheels.

## Product Requirements

### Business requirement

A learner coming from a hatchback can practise in a car that behaves and looks like a real diesel automatic SUV from the first session.

### User stories

- As a learner driver, I want the car to creep in D/R without throttle and require the brake to shift out of P, so that my habits transfer to the real XUV 7XO.
- As a learner driver, I want the scene to look like a real car park, so that judging distances and size feels like real life.

### Actors

- Driver (keyboard), VehiclePhysics, Drivetrain, EngineAudio, Renderer

### Functional requirements — basic

| ID | Requirement |
|---|---|
| REQ-001 | When the gear is D or R, the brake is released and throttle is zero, the drivetrain shall deliver torque-converter creep torque so the car moves at walking pace. |
| REQ-002 | When the driver requests a gear change out of P, the transmission shall change gear only if the brake pedal is pressed and speed is below 1 km/h. |
| REQ-003 | When the driver selects R or P while speed is above 3 km/h, the transmission shall refuse the change and the HUD shall show the reason. |
| REQ-004 | When in D, the transmission shall upshift and downshift automatically according to throttle and speed, including kickdown at full throttle. |
| REQ-005 | When in P, the park pawl shall hold the driven wheels and throttle shall only rev the engine. |
| REQ-006 | The engine audio shall follow engine rpm and load continuously. |

### Functional requirements — failure paths

- `REQ-002-R` — When the shift is refused, the transmission shall keep the current gear and show a HUD message.
- `REQ-006-R` — When the browser blocks audio, the game shall start silent and enable audio on the first user gesture.

### Open points

- none

## Current State Study

- Relevant existing files: `src/vehicle/VehiclePhysics.ts`, `src/config.ts`, `src/core/renderer.ts`, `src/world/practiceGround.ts`, `src/vehicle/VehicleVisual.ts`, `src/ui/Hud.ts`, `src/input/*`, `tests/vehicle.test.ts`
- Existing behavior to preserve: fixed 60 Hz physics with interpolation, turning-circle geometry, braking distance.
- Constraints: 100% client-side, static hosting, no allocations in loop.

## Implementation Spec

- New files: `src/vehicle/Drivetrain.ts`, `src/audio/AudioEngine.ts`, `src/audio/engineWorklet.ts`, `src/core/quality.ts`, `src/core/postprocessing.ts`, `src/core/assets.ts`, `src/vehicle/carGeometry.ts`, `scripts/fetch-assets.py`, `public/assets/**`, `tests/drivetrain.test.ts`
- Updated files: `src/config.ts`, `src/vehicle/VehiclePhysics.ts`, `src/vehicle/VehicleVisual.ts`, `src/core/renderer.ts`, `src/core/Game.ts`, `src/world/practiceGround.ts`, `src/input/InputState.ts`, `src/input/KeyboardInput.ts`, `src/ui/Hud.ts`, `src/style.css`, `README.md`, `tests/vehicle.test.ts`
- Import directions: `vehicle/Drivetrain` is pure (no Three, no Rapier); `VehiclePhysics` imports `Drivetrain`; `Game` wires `audio`, `core`, `vehicle`, `world`, `ui`.

## Scope

### In Scope

- Drivetrain: engine, torque converter, 6-speed AT, P/R/N/D interlocks, park pawl, ignition start/stop.
- Pedals: progressive key ramps, Shift fine-control modifier, EPB toggle with drive-away release, auto-hold toggle.
- Audio: procedural diesel engine, starter, indicator tick, reverse beep, horn; mobile audio unlock.
- Indicators, hazards and headlight toggles (placeholder lamps + HUD).
- HUD: tachometer, PRND strip, EPB / auto-hold / indicator tell-tales, messages.
- Realistic rendering: HDRI background + IBL, ACES tone mapping, PBR photo textures, MSAA, GTAO + bloom (High), quality presets via `?quality=low|medium|high`.
- Smooth bevelled car body, clearcoat paint, glass, realistic tyres and alloys.

### Out Of Scope

- Detailed XUV 7XO styling and cockpit (Stage 3); camera system (Stage 3).
- Settings UI, adaptive Auto quality, touch/gamepad (Stage 7).
- Tyre squeal, kerb scrape, collision sounds (Stage 4); S/manual mode (later, optional).

## Success Criteria

- `AC-1` — In D on flat ground with no throttle or brake, the car creeps to 5–9 km/h.
- `AC-2` — Shifting out of P without the brake, or above 1 km/h, is refused; selecting R or P above 3 km/h is refused.
- `AC-3` — Full throttle from rest reaches 100 km/h in 9–13 s, upshifting through at least 4 gears, with engine rpm never above the rev limit.
- `AC-4` — Full braking from 80 km/h stops within 23–36 m.
- `AC-5` — In P, full throttle revs the engine but the car does not move more than 5 cm.
- `AC-6` — After the first user gesture, engine sound pitch follows rpm and starter, indicator tick, reverse beep and horn are audible (manual check).
- `AC-7` — Screenshot shows HDRI sky, photo-textured ground and reflective paint, with no hard box edges on the car body (manual check).
- `AC-8` — The full-lock turning circle test still passes (5.4 m within −8 % / +12 %).

### Non-functional

- `NFR-1` — The game shall render at 60 FPS on an Apple M5 MacBook at High quality (owner verifies on device).
- `NFR-2` — Total committed runtime assets shall stay below 12 MB.

## Tests

- Must-have tests: `tests/drivetrain.test.ts` (AC-1, AC-2, AC-3, AC-5), `tests/vehicle.test.ts` (AC-4, AC-8).
- Out of scope for testing: audio and visuals are verified manually/with a headless screenshot (no audio device or GPU in CI).
- Test framework or runner: Vitest (Node).

## Dependencies / Blockers

- Dependencies: Poly Haven CC0 assets (downloaded once, committed).
- Blockers: none

## Risk Register

| ID | Category | Likelihood | Impact | Mitigation | Residual | Owner |
|---|---|---|---|---|---|---|
| RISK-1 | Performance | med | high | GTAO/bloom/MSAA only on High; `?quality=` presets; Stage 7 adds adaptive Auto (NFR-1) | Owner must confirm FPS on M5 | park-pro-xuv developer |
| RISK-2 | Numerical stability | med | med | Engine/torque-converter integration sub-stepped inside each physics step; unit tests (AC-1, AC-3) | Edge cases at gear changes | park-pro-xuv developer |

## Activity Log

- 2026-11-14 18:50 Record created; scope from owner's Stage 2 approval plus realism direction. (author: prajwr, assisted, main, b0a580e)

## Risks And Unknowns

- Procedural diesel audio may sound synthetic compared with recorded samples; recorded samples would need a licensed source.
