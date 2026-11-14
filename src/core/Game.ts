/**
 * Top-level game: loads assets, wires physics, rendering, input, audio, cameras,
 * levels, menus and HUD together and runs the main loop.
 *
 * Loop model: physics advances in fixed 1/60 s steps (accumulator); rendering
 * runs at display rate and interpolates the car between the last two physics
 * states, so motion stays smooth on 60/90/120 Hz displays and under frame jitter.
 * Slow motion scales the time fed to the accumulator, so physics stays exact.
 */

import { PAINT_COLOURS, PHYSICS, XUV_7XO, XUV_DRIVETRAIN, XUV_TUNING } from '../config';
import { AudioEngine } from '../audio/AudioEngine';
import { CAMERA_MODES, CameraRig, type CameraMode } from '../cameras/CameraRig';
import { InteriorMirror } from '../cameras/InteriorMirror';
import { PipOverlay, PipView, type ScreenRect } from '../cameras/PipView';
import { GUIDE_LAYER } from '../cameras/reverseGuidelines';
import { InputState } from '../input/InputState';
import { KeyboardInput } from '../input/KeyboardInput';
import { PointerInput } from '../input/PointerInput';
import { GuideVisuals } from '../levels/GuideVisuals';
import { LevelSession } from '../levels/LevelSession';
import { LEVELS } from '../levels/levels';
import type { Difficulty, OrientedRect, Pose } from '../levels/types';
import { Hud } from '../ui/Hud';
import { Menus, type MenuActions } from '../ui/Menus';
import { ParkingSensors } from '../vehicle/ParkingSensors';
import { maxCentreSteerAngle } from '../vehicle/steering';
import { VehicleLights } from '../vehicle/VehicleLights';
import { VehiclePhysics } from '../vehicle/VehiclePhysics';
import { STEERING_WHEEL_LOCK_RAD, VehicleVisual } from '../vehicle/VehicleVisual';
import { buildBaseGround, type BaseGround } from '../world/baseGround';
import { LevelProps } from '../world/levelProps';
import { loadAssets } from './assets';
import { createPhysics, type PhysicsContext } from './physics';
import { pickQuality } from './quality';
import { createRenderContext, createRenderer, type RenderContext } from './renderer';
import { isUnlocked, loadProgress, loadSettings, recordScore, saveSettings, scoreKey, type Progress, type Settings } from './storage';

const RAD_TO_DEG = 180 / Math.PI;
const SLOW_MOTION = 0.35;
const RESULT_DELAY_S = 1.2;
const SHAKE_S = 0.3;
const DIFF_LABEL: Record<Difficulty, string> = { beginner: 'Beginner', normal: 'Normal', hard: 'Hard' };
const MIRROR_LABEL = { off: 'Door mirrors off', cabin: 'Door mirrors in cabin views', all: 'Door mirrors in all views' } as const;

export class Game {
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly hud: Hud;
  private readonly menus: Menus;
  private readonly rig: CameraRig;
  private readonly car: VehiclePhysics;
  /** Body and door-mirror colliders: contacts with any of them are the car's. */
  private readonly carColliders: Set<number>;
  private readonly lights = new VehicleLights();
  private readonly carVisual: VehicleVisual;
  private readonly sensors: ParkingSensors;
  private readonly base: BaseGround;
  private readonly props: LevelProps;
  private readonly guides: GuideVisuals;
  private readonly overlay = new PipOverlay();
  private readonly rearPip: PipView;
  /** [right mirror (driver's side), left mirror]. */
  private readonly mirrorPips: PipView[];
  private readonly interiorMirror: InteriorMirror;
  private readonly settings: Settings;
  private readonly progress: Progress;
  private readonly maxSteer = maxCentreSteerAngle(XUV_7XO);
  private audio: AudioEngine | null = null;
  private audioStarting = false;

  private session!: LevelSession;
  private levelIndex = 0;
  private resultTimer = -1;
  private resultDelayS = RESULT_DELAY_S;
  private slowMotion = false;
  private demoReturn: (() => void) | null = null;
  private demoCameraReturn: CameraMode | null = null;
  private pauseCameraReturn: CameraMode | null = null;
  private shakeTime = 0;
  private shakeAmp = 0;

  private accumulator = 0;
  private lastTime = -1;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastSelector = 'P';
  private rearFull = false;
  private readonly rearRect: ScreenRect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly fullRect: ScreenRect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly pose: Pose = { x: 0, z: 0, yaw: 0 };
  private shownZone: OrientedRect | null = null;

  private constructor(
    private readonly phys: PhysicsContext,
    private readonly gfx: RenderContext,
    assets: Awaited<ReturnType<typeof loadAssets>>,
    hudRoot: HTMLElement,
  ) {
    this.settings = loadSettings(gfx.quality.level === 'high');
    this.progress = loadProgress();
    this.base = buildBaseGround(gfx.scene, phys, assets);
    this.props = new LevelProps(gfx.scene, phys, assets);

    this.car = new VehiclePhysics(phys.R, phys.world, XUV_7XO, XUV_TUNING, XUV_DRIVETRAIN, { x: 0, z: 0, yaw: 0 });
    this.carColliders = new Set(this.car.colliderHandles);
    this.sensors = new ParkingSensors(phys.R, phys.world, this.car.body, XUV_7XO);
    const paintIdx = Number(new URLSearchParams(location.search).get('paint') ?? 0);
    this.carVisual = new VehicleVisual(this.car, this.lights, PAINT_COLOURS[paintIdx] ?? PAINT_COLOURS[0]);
    gfx.scene.add(this.carVisual.root);
    const root = this.carVisual.root;

    this.guides = new GuideVisuals(gfx.scene, XUV_7XO);
    root.add(this.guides.eon, this.guides.zones);

    this.rig = new CameraRig(gfx.camera, this.carVisual);
    if (CAMERA_MODES.some((m) => m.id === this.settings.camera)) this.rig.setMode(this.settings.camera as CameraMode);

    // Reverse camera on the tailgate: wide angle, tilted down, mirrored like the real display.
    this.rearPip = new PipView(72, true, this.overlay);
    this.rearPip.camera.layers.enable(GUIDE_LAYER);
    this.rearPip.camera.position.copy(this.carVisual.rearCameraMount);
    this.rearPip.camera.rotation.set(-0.55, 0, 0, 'YXZ');
    root.add(this.rearPip.camera);

    // Door mirrors: look back and slightly outward; mirrored image.
    this.mirrorPips = this.carVisual.mirrorMounts.map((m) => {
      const pip = new PipView(22, true, this.overlay);
      const side = Math.sign(m.x);
      pip.camera.position.copy(m);
      pip.camera.rotation.set(-0.06, -side * 0.24, 0, 'YXZ');
      root.add(pip.camera);
      return pip;
    });
    this.interiorMirror = new InteriorMirror(root, this.carVisual.interiorMirrorMount, this.carVisual.interiorMirrorGlass);

    this.keyboard = new KeyboardInput(this.input, XUV_TUNING.pedals);
    new PointerInput(this.input, gfx.renderer.domElement);
    this.hud = new Hud(hudRoot);
    this.menus = new Menus(this.menuActions, XUV_7XO);
    window.addEventListener('pointerdown', () => (this.input.hadUserGesture = true), { capture: true });

    window.addEventListener('resize', () => {
      gfx.resize();
      this.layout();
    });
    // Don't simulate a huge catch-up step after the tab was hidden.
    document.addEventListener('visibilitychange', () => {
      this.lastTime = -1;
    });
    this.layout();

    this.loadLevel(0);
    this.menus.showLevels(LEVELS, this.progress, this.settings, true);
    if (import.meta.env.DEV) this.devStart(new URLSearchParams(location.search));
  }

  /** Dev-only deep links for testing: ?level=4&diff=hard&cam=topdown&menu=tutorial|pause|none&demo&guides=0&eon&predict&gear=R&x=0&z=0&yaw=0&fast */
  private devStart(q: URLSearchParams): void {
    const diff = q.get('diff');
    if (diff === 'beginner' || diff === 'normal' || diff === 'hard') this.settings.difficulty = diff;
    if (q.has('eon')) this.settings.eonOutline = true;
    if (q.has('predict')) this.settings.predictedPath = true;
    if (q.get('guides') === '0') this.settings.guides = false;
    const mirrors = q.get('mirrors');
    if (mirrors === 'off' || mirrors === 'cabin' || mirrors === 'all') this.settings.mirrors = mirrors;
    const level = Number(q.get('level'));
    if (level >= 1 && level <= LEVELS.length) {
      this.loadLevel(level - 1);
      this.menus.hide();
    }
    const cam = q.get('cam');
    if (cam && CAMERA_MODES.some((m) => m.id === cam)) this.rig.setMode(cam as CameraMode);
    const menu = q.get('menu');
    if (menu === 'tutorial') this.menus.showTutorial(this.session.def, this.session.layout, this.settings.difficulty);
    if (menu === 'pause') this.menus.showPause(this.settings, !!this.session.layout.ideal);
    if (q.has('x') && q.has('z')) this.placeCar({ x: Number(q.get('x')), z: Number(q.get('z')), yaw: Number(q.get('yaw') ?? 0) }, Number(q.get('y') ?? 0));
    const gear = q.get('gear');
    if (gear === 'D' || gear === 'R') this.car.drivetrain.selector = gear;
    if (q.has('fast')) this.resultDelayS = 0.01;
    if (q.has('demo')) this.startDemo();
  }

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement, onProgress: (f: number) => void): Promise<Game> {
    const quality = pickQuality();
    const renderer = createRenderer(canvas, quality);
    const [phys, assets] = await Promise.all([createPhysics(), loadAssets(quality.anisotropy, onProgress)]);
    const gfx = createRenderContext(renderer, assets, quality);
    const game = new Game(phys, gfx, assets, hudRoot);
    // Compile all shaders up front so the first frames don't stutter.
    await renderer.compileAsync(gfx.scene, gfx.camera);
    return game;
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(this.frame);
  }

  // --- Levels ---------------------------------------------------------------------------

  private loadLevel(index: number): void {
    this.levelIndex = index;
    const def = LEVELS[index];
    this.session = new LevelSession(def, this.settings.difficulty, XUV_7XO);
    const L = this.session.layout;
    this.props.build(L);
    this.guides.setIdeal(this.session.path, L.ideal, this.props.terrain);
    this.guides.idealVisible = this.settings.guides;
    this.shownZone = null;
    this.syncZone();
    this.placeCar(L.spawn, 0);
    this.accumulator = 0;
    this.resultTimer = -1;
    this.hud.setLevel(def.id === 1 ? `Level 1 · ${def.title}` : `Level ${def.id} · ${def.title} · ${DIFF_LABEL[this.settings.difficulty]}`);
  }

  private readonly menuActions: MenuActions = {
    startLevel: (id) => {
      this.loadLevel(LEVELS.findIndex((l) => l.id === id));
      this.menus.showTutorial(this.session.def, this.session.layout, this.settings.difficulty);
    },
    begin: () => this.menus.hide(),
    retry: () => {
      this.loadLevel(this.levelIndex);
      this.menus.hide();
      this.restorePauseCamera();
    },
    next: () => {
      const n = this.levelIndex + 1;
      if (n >= LEVELS.length) return;
      this.loadLevel(n);
      this.menus.showTutorial(this.session.def, this.session.layout, this.settings.difficulty);
    },
    showLevels: () => {
      this.restorePauseCamera();
      this.menus.showLevels(LEVELS, this.progress, this.settings, !this.session.finished);
    },
    resume: () => {
      this.menus.hide();
      this.restorePauseCamera();
    },
    checkpoint: () => {
      this.menus.hide();
      this.restorePauseCamera();
      this.toCheckpoint();
    },
    demo: () => this.startDemo(),
    setDifficulty: (d) => {
      this.settings.difficulty = d;
      saveSettings(this.settings);
      this.menus.showLevels(LEVELS, this.progress, this.settings, !this.session.finished);
    },
    setSetting: (key, value) => {
      this.settings[key] = value;
      saveSettings(this.settings);
      if (key === 'allLevelsOpen') this.menus.showLevels(LEVELS, this.progress, this.settings, !this.session.finished);
      if (key === 'guides') this.guides.idealVisible = this.settings.guides;
    },
  };

  private toCheckpoint(): void {
    if (this.session.finished) return;
    const { pose, y } = this.session.restoreCheckpoint();
    this.placeCar(pose, y);
    this.car.notify('Back to your last stop — select a gear to continue');
  }

  /** Reset the car at a pose on the drivable surface nearest to height `refY`, pitched to the slope. */
  private placeCar(pose: Pose, refY: number): void {
    const t = this.props.terrain;
    const y = t.height(pose.x, pose.z, refY);
    this.car.reset({ ...pose, y, pitch: t.pitch(pose.x, pose.z, pose.yaw, y) });
    this.rig.snap();
    this.accumulator = 0;
  }

  /** Outline the session's current target or gate (only rebuilt when it changes). */
  private syncZone(): void {
    const z = this.session.finished ? null : this.session.highlight;
    if (z === this.shownZone) return;
    this.shownZone = z;
    this.props.showZone(z);
  }

  private startDemo(): void {
    if (!this.guides.playGhost()) return;
    const from = this.menus.screen;
    this.menus.hide();
    this.restorePauseCamera();
    this.demoReturn =
      from === 'tutorial'
        ? () => this.menus.showTutorial(this.session.def, this.session.layout, this.settings.difficulty)
        : from === 'result' && this.session.result
          ? () => this.showResult(false)
          : null;
    if (this.rig.mode !== 'topdown') {
      this.demoCameraReturn = this.rig.mode;
      this.rig.setMode('topdown');
    }
  }

  private endDemo(): void {
    this.guides.stopGhost();
    if (this.demoCameraReturn) this.rig.setMode(this.demoCameraReturn);
    this.demoCameraReturn = null;
    const ret = this.demoReturn;
    this.demoReturn = null;
    ret?.();
  }

  private showResult(record: boolean): void {
    const r = this.session.result!;
    const def = this.session.def;
    let newBest = false;
    if (record && !r.failed) newBest = recordScore(this.progress, scoreKey(def.id, this.settings.difficulty), { stars: r.score.stars, points: r.score.points, timeS: r.timeS });
    const next = LEVELS[this.levelIndex + 1];
    const hasNext = !!next && isUnlocked(next.id, this.progress, this.settings.allLevelsOpen);
    this.menus.showResult(def, r, newBest, hasNext, !!this.session.layout.ideal);
  }

  private restorePauseCamera(): void {
    if (this.pauseCameraReturn) this.rig.setMode(this.pauseCameraReturn);
    this.pauseCameraReturn = null;
  }

  // --- Frame ------------------------------------------------------------------------------

  /** Screen placement of the picture-in-picture views (CSS pixels). */
  private layout(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.overlay.resize(W, H);
    const pr = this.gfx.renderer.getPixelRatio();

    const rw = Math.round(Math.min(520, W * 0.42));
    this.rearRect.w = rw;
    this.rearRect.h = Math.round((rw * 9) / 16);
    this.rearRect.x = Math.round((W - rw) / 2);
    this.rearRect.y = 64;
    this.fullRect.w = W;
    this.fullRect.h = H;
    this.rearPip.setRect(this.rearFull ? this.fullRect : this.rearRect, pr, this.rearFull ? 0 : 3);

    const mw = Math.round(Math.min(300, W * 0.22));
    const mh = Math.round(mw * 0.5);
    for (const pip of this.mirrorPips) {
      const right = pip.camera.position.x < 0; // driver's (right-hand) mirror goes on the right of the screen
      pip.setRect({ x: right ? W - mw - 16 : 16, y: 96, w: mw, h: mh }, pr);
    }
  }

  private readonly frame = (timeMs: number): void => {
    const now = timeMs / 1000;
    const dt = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, 0.25);
    this.lastTime = now;

    this.keyboard.poll(dt);
    this.ensureAudio();
    this.handleActions();

    const demo = this.guides.ghostPlaying;
    const frozen = this.menus.isOpen || demo;
    if (!frozen) {
      this.accumulator += dt * (this.slowMotion ? SLOW_MOTION : 1);
      const step = PHYSICS.fixedDt;
      let steps = 0;
      while (this.accumulator >= step && steps < PHYSICS.maxSubSteps) {
        this.car.update(this.input, step);
        this.phys.world.step(this.phys.events);
        this.car.postStep();
        this.accumulator -= step;
        steps++;
      }
      if (steps === PHYSICS.maxSubSteps) this.accumulator = 0; // too slow: drop time instead of spiralling
      this.lights.update(dt, this.car.steerPosition);
      this.handleContacts();
      this.updateSession(dt);
    } else {
      this.phys.events.drainCollisionEvents(() => {});
    }
    if (demo) {
      this.guides.updateGhost(dt);
      if (!this.guides.ghostPlaying) this.endDemo();
    }
    this.props.update();

    const alpha = this.accumulator / PHYSICS.fixedDt;
    const root = this.carVisual.root;
    this.carVisual.update(alpha, dt);
    root.updateMatrixWorld();

    const d = this.car.drivetrain;
    const reversing = d.selector === 'R';
    this.sensors.update(dt, d.selector, this.car.speedKmh);
    this.guides.updateZones(this.sensors.distances, this.sensors.active);

    this.rig.showGuides = reversing;
    this.rig.update(this.input, dt);
    this.applyShake(dt);
    this.gfx.followShadow(root.position.x, root.position.z);

    const s = this.settings;
    const steer = this.car.centreSteerAngle / this.maxSteer;
    this.pose.x = root.position.x;
    this.pose.z = root.position.z;
    this.pose.yaw = yawOf(root.quaternion);
    this.guides.updatePredicted(s.predictedPath && !demo && (d.selector === 'D' || reversing), this.pose, steer, reversing ? -1 : 1, root.position.y);
    this.guides.eon.visible = s.eonOutline;

    // Views: full-screen rear camera replaces the main view; otherwise main view plus PiPs.
    const mode = this.rig.mode;
    const rearFull = mode === 'rear';
    if (rearFull !== this.rearFull) {
      this.rearFull = rearFull;
      this.layout();
    }
    const inCabin = mode === 'driver' || mode === 'bonnet';
    const overhead = mode === 'surround' || mode === 'topdown';
    this.rearPip.visible = rearFull || (s.autoRearCamera && reversing && !overhead && !demo);
    const mirrors = !rearFull && !demo && (s.mirrors === 'all' ? !overhead : s.mirrors === 'cabin' && inCabin);
    for (const pip of this.mirrorPips) pip.visible = mirrors;
    this.interiorMirror.visible = mode === 'driver';
    if (this.rearPip.visible || this.rig.showGuides) this.carVisual.guidelines.update(this.car.centreSteerAngle);

    const renderer = this.gfx.renderer;
    this.interiorMirror.render(renderer, this.gfx.scene);
    if (rearFull) renderer.shadowMap.needsUpdate = true;
    else this.gfx.render(dt);
    this.rearPip.render(renderer, this.gfx.scene);
    for (const pip of this.mirrorPips) pip.render(renderer, this.gfx.scene);
    if (this.rearPip.visible || mirrors) this.overlay.render(renderer);
    this.hud.setReverseCaption(this.rearPip.visible ? this.rearPip.rect : null);

    this.updateAudio(dt);
    this.updateFps(dt);
    this.updateHud(dt, demo);
  };

  private handleContacts(): void {
    const car = this.carColliders;
    this.phys.events.drainCollisionEvents((h1, h2, started) => {
      if (!started || car.has(h1) === car.has(h2)) return;
      const other = car.has(h1) ? h2 : h1;
      if (other === this.base.groundHandle || this.props.kerbHandles.has(other) || this.props.groundHandles.has(other)) return;
      const cone = this.props.coneHandles.get(other);
      const impact = Math.min(1, Math.abs(this.car.speedMs) / 3);
      if (cone !== undefined) {
        if (this.session.onConeHit(cone)) {
          this.audio?.bump(0.15);
          this.car.notify('Cone hit');
        }
        return;
      }
      if (this.session.onCollision(other)) {
        this.audio?.bump(impact);
        this.shakeTime = SHAKE_S;
        this.shakeAmp = 0.03 + 0.08 * impact;
        this.car.notify('Collision!');
      }
    });
  }

  private updateSession(dt: number): void {
    const c = this.car.curr;
    const s = this.session;
    const wasFinished = s.finished;
    this.pose.x = c.pos.x;
    this.pose.z = c.pos.z;
    this.pose.yaw = yawOfQuat(c.quat.x, c.quat.y, c.quat.z, c.quat.w);
    const ev = s.update(
      { pose: this.pose, y: c.pos.y, speedMs: this.car.speedMs, selector: this.car.drivetrain.selector, parkingBrake: this.car.parkingBrake },
      dt,
    );
    const limit = s.layout.rules?.kerbTouchLimit;
    if (ev.kerb) {
      this.audio?.kerbScrape();
      this.car.notify(limit !== undefined && !s.finished ? `Kerb touch — ${Math.max(0, limit - s.kerbTouches + 1)} more ends the attempt` : 'Kerb touch');
    }
    if (ev.bump > 0) this.audio?.bump(0.12 + 0.3 * ev.bump);
    if (ev.bumpTooFast) this.car.notify(`Too fast over the speed bump — keep below ${s.layout.rules?.bumpMaxKmh ?? 10} km/h`);
    if (ev.rollback) this.car.notify('Rolling back! Hold the brake while you change gear or release the parking brake');
    if (ev.stopDone) {
      this.audio?.chime();
      this.car.notify(`${capitalise(ev.stopDone.name ?? 'Stop')} done — now drive to the next space`);
    }
    this.syncZone();
    if (!wasFinished && s.finished) {
      if (s.result?.failed) {
        this.audio?.bump(0.4);
        this.car.notify(s.result.failed);
      } else this.audio?.chime();
      this.resultTimer = this.resultDelayS;
    }
    if (this.resultTimer > 0) {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) this.showResult(true);
    }
  }

  private applyShake(dt: number): void {
    if (this.shakeTime <= 0) return;
    this.shakeTime -= dt;
    const k = Math.max(0, this.shakeTime / SHAKE_S) * this.shakeAmp;
    const cam = this.gfx.camera;
    cam.position.x += (Math.random() * 2 - 1) * k;
    cam.position.y += (Math.random() * 2 - 1) * k;
    cam.position.z += (Math.random() * 2 - 1) * k;
  }

  private handleActions(): void {
    const i = this.input;
    const s = this.settings;
    if (i.consume('pause')) {
      if (this.guides.ghostPlaying) this.endDemo();
      else if (!this.menus.isOpen) {
        this.pauseCameraReturn = this.rig.mode === 'orbit' ? null : this.rig.mode;
        this.rig.setMode('orbit');
        this.menus.showPause(s, !!this.session.layout.ideal);
      }
    }
    if (this.menus.isOpen) {
      // Driving actions are ignored while a menu is open.
      for (const a of ['reset', 'checkpoint', 'selectorUp', 'selectorDown', 'parkingBrake', 'autoHold', 'ignition', 'camera'] as const) i.consume(a);
      i.selectCamera = -1;
      return;
    }
    if (i.consume('reset')) this.menuActions.retry();
    if (i.consume('checkpoint')) this.toCheckpoint();
    if (i.consume('selectorUp')) this.car.shiftSelector(-1);
    if (i.consume('selectorDown')) this.car.shiftSelector(1);
    if (i.consume('parkingBrake')) this.car.toggleParkingBrake();
    if (i.consume('autoHold')) this.car.toggleAutoHold();
    if (i.consume('ignition')) this.car.toggleIgnition();
    if (i.consume('indicatorLeft')) this.lights.toggleLeft();
    if (i.consume('indicatorRight')) this.lights.toggleRight();
    if (i.consume('hazards')) this.lights.toggleHazards();
    if (i.consume('lights')) this.lights.headlights = !this.lights.headlights;
    if (i.consume('slowMotion')) {
      this.slowMotion = !this.slowMotion;
      this.car.notify(this.slowMotion ? 'Slow motion on' : 'Slow motion off');
    }
    if (i.consume('mirrors')) {
      s.mirrors = s.mirrors === 'off' ? 'cabin' : s.mirrors === 'cabin' ? 'all' : 'off';
      this.car.notify(MIRROR_LABEL[s.mirrors]);
      saveSettings(s);
    }
    if (i.consume('guides')) {
      s.guides = !s.guides;
      this.guides.idealVisible = s.guides;
      this.car.notify(s.guides ? 'Guides on' : 'Guides off');
      saveSettings(s);
    }
    if (i.consume('eonOutline')) {
      s.eonOutline = !s.eonOutline;
      this.car.notify(s.eonOutline ? 'Hyundai Eon outline on' : 'Hyundai Eon outline off');
      saveSettings(s);
    }
    if (i.consume('autoRearCamera')) {
      s.autoRearCamera = !s.autoRearCamera;
      this.car.notify(s.autoRearCamera ? 'Rear camera in R: on' : 'Rear camera in R: off');
      saveSettings(s);
    }
    let cameraChanged = false;
    if (i.consume('camera')) {
      this.rig.next();
      cameraChanged = true;
    }
    if (i.selectCamera >= 0) {
      const m = CAMERA_MODES[i.selectCamera];
      if (m) this.rig.setMode(m.id);
      i.selectCamera = -1;
      cameraChanged = true;
    }
    if (cameraChanged && s.camera !== this.rig.mode) {
      s.camera = this.rig.mode;
      saveSettings(s);
    }
  }

  private updateHud(dt: number, demo: boolean): void {
    const d = this.car.drivetrain;
    const s = this.session;
    this.hud.update(
      {
        speedKmh: this.car.speedKmh,
        rpm: d.engineRpm,
        revLimitRpm: d.cfg.revLimitRpm,
        selector: d.selector,
        gear: d.gear,
        engineRunning: d.engineRunning,
        cranking: d.cranking,
        parkingBrake: this.car.parkingBrake,
        autoHoldEnabled: this.car.autoHoldEnabled,
        autoHoldActive: this.car.autoHoldActive,
        leftLit: this.lights.leftLit,
        rightLit: this.lights.rightLit,
        headlights: this.lights.headlights,
        steerDeg: this.car.steerPosition * STEERING_WHEEL_LOCK_RAD * RAD_TO_DEG,
        fps: this.fps,
        cameraLabel: this.rig.label,
        message: this.car.message,
        messageAge: this.car.messageAge,
      },
      dt,
    );
    this.hud.updateLevel(
      {
        timeS: s.timeS,
        collisions: s.collisions,
        kerbTouches: s.kerbTouches,
        conesHit: s.conesHit,
        directionChanges: s.directionChanges,
        gates: s.isCourse ? `${Math.min(s.gateIndex, s.layout.gates!.length)} / ${s.layout.gates!.length}` : '',
      },
      dt,
    );
    const showHint = !demo && !this.menus.isOpen && (this.settings.guides || s.isCourse);
    this.hud.setHint(showHint ? s.hint : demo ? 'Ideal manoeuvre — press Esc to stop' : '');
    this.hud.setSensors(this.sensors.distances, this.sensors.active && !this.menus.isOpen, this.sensors.nearest);
    const chips: string[] = [];
    if (this.slowMotion) chips.push('Slow motion');
    if (s.usedCheckpoint && !s.finished) chips.push('Checkpoint used');
    if (!this.settings.guides && s.isParkingLevel) chips.push('Guides off (G)');
    this.hud.setChips(chips);
  }

  /** Audio can only start after a user gesture (browser autoplay rules). */
  private ensureAudio(): void {
    if (this.audio || this.audioStarting || !this.input.hadUserGesture) return;
    this.audioStarting = true;
    AudioEngine.create()
      .then((a) => (this.audio = a))
      .catch((e) => console.warn('Audio unavailable:', e));
  }

  private updateAudio(dt: number): void {
    const a = this.audio;
    if (!a) return;
    const d = this.car.drivetrain;
    if (this.lights.relayFlipped) a.indicatorTick(this.lights.blinkOn);
    if (d.selector !== this.lastSelector) {
      if (d.selector === 'D' || d.selector === 'R') a.gearClunk();
      this.lastSelector = d.selector;
    }
    const quiet = this.menus.isOpen;
    a.update(
      {
        rpm: d.engineRpm,
        load: d.load,
        throttle: this.car.throttle,
        cranking: d.cranking,
        running: d.engineRunning,
        horn: this.input.horn && !quiet,
        reverse: d.selector === 'R' && d.engineRunning && !quiet,
        sensorM: quiet ? null : this.sensors.nearest,
      },
      dt,
    );
  }

  private updateFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }
}

function capitalise(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function yawOfQuat(x: number, y: number, z: number, w: number): number {
  // Heading of the rotated +Z axis projected on the ground.
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

function yawOf(q: { x: number; y: number; z: number; w: number }): number {
  return yawOfQuat(q.x, q.y, q.z, q.w);
}
