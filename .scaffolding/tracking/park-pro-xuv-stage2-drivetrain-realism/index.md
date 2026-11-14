---
schema_version: 3
artifact: index
artifact_schema_version: 1
title: Park Pro XUV - Stage 2 automatic drivetrain, engine audio and realistic rendering
slug: park-pro-xuv-stage2-drivetrain-realism
status: implemented
source: direct-user-request
owner: park-pro-xuv developer
issue: pending
pull_request: pending
started: 2026-11-14 18:50
last_updated: 2026-11-14 19:20
blocked_by: none
current_checkpoint: implementation complete
goal_lock:
  status: active
  stamped: 2026-11-14 18:50
  scope:
    - Automatic transmission (P/R/N/D), torque converter creep, engine model, brakes/EPB/auto-hold
    - Procedural WebAudio diesel engine and car sounds
    - Realistic rendering foundation (HDRI/IBL, PBR photo textures, post-processing, smoother car)
  success_criteria: [AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8]
---

# Park Pro XUV - Stage 2 automatic drivetrain, engine audio and realistic rendering

This index is the identity and lifecycle rollup for one schema-v3 feature directory. Use team, role, ticket, or system identifiers; do not record personal data.

`closeout complete` is stamped only in this file. Once it has a real timestamp, the entire feature directory is sealed and none of its files may be edited.

## Feature Definition

- One-line goal: Make the XUV drive like a real diesel automatic (P/R/N/D, creep, engine sound) and make the game look photo-realistic rather than cartoonish.
- Problem: Stage 1 has an arcade drive model (auto-reverse on S, no gearbox, no sound) and flat placeholder graphics with hard box edges.
- Requested by: project owner (direct chat request, Stage 2 approval plus realism direction)
- Related links:
  - none

## Navigation

- [Specification](./spec.md) — created with the index at `start`.
- [Build](./build.md) — created at `implementation started`.
- `closeout.md` — created when reflection or closeout begins.

## Checkpoints

- [x] start | completed: `2026-11-14 18:50`
- [x] spec / plan created | completed: `2026-11-14 18:50`
- [ ] threat-model stamped | completed: `pending`
- [x] implementation started | completed: `2026-11-14 18:50`
- [x] implementation complete | completed: `2026-11-14 19:20`
- [ ] critic pass | completed: `pending`
- [ ] risk-register reviewed | completed: `pending`
- [ ] feature validated | completed: `pending`
- [ ] PR created | completed: `pending`
- [ ] closeout complete | completed: `pending`

## Notes

- Stage 1 baseline commit: `b0a580e` (branch `main`, local repo, no remote yet).

## Decisions

- Key bindings: E/X = shift down the gate (P→R→N→D), Q/Z = shift up (D→N→R→P); `,` `.` = indicators, `/` = hazards, R = reset, Space = EPB toggle, B = auto-hold, Shift = fine pedal control — resolves Q/E/Z/R conflicts in the original brief; approved by the project owner ("yes"). (author: prajwr, assisted, main, b0a580e)
- Realism uses CC0 Poly Haven photo-scanned PBR textures and a real sky HDRI committed under `public/assets/` (with a fetch script for provenance) instead of procedural textures — procedural ground and flat sky read as cartoonish, which the owner explicitly rejected. (author: prajwr, assisted, main, b0a580e)
- Detailed XUV 7XO styling (grille, split lamps, mirrors, cockpit) stays in Stage 3; Stage 2 only replaces the hard-edged placeholder with a smooth, bevelled body, clearcoat paint, glass and realistic wheels. (author: prajwr, assisted, main, b0a580e)
