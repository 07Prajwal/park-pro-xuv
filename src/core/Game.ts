/**
 * Top-level game: loads assets, wires physics, rendering, input, audio, cameras
 * and HUD together and runs the main loop.
 *
 * Loop model: physics advances in fixed 1/60 s steps (accumulator); rendering
 * runs at display rate and interpolates the car between the last two physics
 * states, so motion stays smooth on 60/90/120 Hz displays and under frame jitter.
 */

import { PAINT_COLOURS, PHYSICS, XUV_7XO, XUV_DRIVETRAIN, XUV_TUNING } from '../config';
import { AudioEngine } from '../audio/AudioEngine';
import { CAMERA_MODES, CameraRig } from '../cameras/CameraRig';
import { PipOverlay, PipView, type ScreenRect } from '../cameras/PipView';
import { GUIDE_LAYER } from '../cameras/reverseGuidelines';
import { InputState } from '../input/InputState';
import { KeyboardInput } from '../input/KeyboardInput';
import { PointerInput } from '../input/PointerInput';
import { Hud } from '../ui/Hud';
import { VehicleLights } from '../vehicle/VehicleLights';
import { VehiclePhysics, type Spawn } from '../vehicle/VehiclePhysics';
import { STEERING_WHEEL_LOCK_RAD, VehicleVisual } from '../vehicle/VehicleVisual';
import { buildPracticeGround } from '../world/practiceGround';
import { loadAssets } from './assets';
import { createPhysics, type PhysicsContext } from './physics';
import { pickQuality } from './quality';
import { createRenderContext, createRenderer, type RenderContext } from './renderer';

const SPAWN: Spawn = { x: 0, z: -55, yaw: 0 };
const RAD_TO_DEG = 180 / Math.PI;

export class Game {
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly hud: Hud;
  private readonly rig: CameraRig;
  private readonly car: VehiclePhysics;
  private readonly lights = new VehicleLights();
  private readonly carVisual: VehicleVisual;
  private readonly overlay = new PipOverlay();
  private readonly rearPip: PipView;
  /** [right mirror (driver's side), left mirror]. */
  private readonly mirrorPips: PipView[];
  private mirrorsEnabled: boolean;
  private audio: AudioEngine | null = null;
  private audioStarting = false;

  private accumulator = 0;
  private lastTime = -1;
  private paused = false;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastSelector = 'P';
  private rearFull = false;
  private readonly rearRect: ScreenRect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly fullRect: ScreenRect = { x: 0, y: 0, w: 1, h: 1 };

  private constructor(
    private readonly phys: PhysicsContext,
    private readonly gfx: RenderContext,
    assets: Awaited<ReturnType<typeof loadAssets>>,
    hudRoot: HTMLElement,
  ) {
    buildPracticeGround(gfx.scene, phys, assets);

    this.car = new VehiclePhysics(phys.R, phys.world, XUV_7XO, XUV_TUNING, XUV_DRIVETRAIN, SPAWN);
    const paintIdx = Number(new URLSearchParams(location.search).get('paint') ?? 0);
    this.carVisual = new VehicleVisual(this.car, this.lights, PAINT_COLOURS[paintIdx] ?? PAINT_COLOURS[0]);
    gfx.scene.add(this.carVisual.root);
    const root = this.carVisual.root;

    this.rig = new CameraRig(gfx.camera, this.carVisual);

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
    this.mirrorsEnabled = gfx.quality.level === 'high';

    this.keyboard = new KeyboardInput(this.input, XUV_TUNING.pedals);
    new PointerInput(this.input, gfx.renderer.domElement);
    this.hud = new Hud(hudRoot);

    window.addEventListener('resize', () => {
      gfx.resize();
      this.layout();
    });
    // Don't simulate a huge catch-up step after the tab was hidden.
    document.addEventListener('visibilitychange', () => {
      this.lastTime = -1;
    });
    this.layout();
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

    if (!this.paused) {
      this.accumulator += dt;
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
    }

    const alpha = this.accumulator / PHYSICS.fixedDt;
    const root = this.carVisual.root;
    this.carVisual.update(alpha, dt);
    root.updateMatrixWorld();

    const reversing = this.car.drivetrain.selector === 'R';
    this.rig.showGuides = reversing;
    this.rig.update(this.input, dt);
    this.gfx.followShadow(root.position.x, root.position.z);

    // Views: full-screen rear camera replaces the main view; otherwise main view plus PiPs.
    const rearFull = this.rig.mode === 'rear';
    if (rearFull !== this.rearFull) {
      this.rearFull = rearFull;
      this.layout();
    }
    const inCabin = this.rig.mode === 'driver' || this.rig.mode === 'bonnet';
    this.rearPip.visible = rearFull || (reversing && this.rig.mode !== 'surround' && this.rig.mode !== 'topdown');
    for (const pip of this.mirrorPips) pip.visible = this.mirrorsEnabled && inCabin;
    if (this.rearPip.visible || this.rig.showGuides) this.carVisual.guidelines.update(this.car.centreSteerAngle);

    const renderer = this.gfx.renderer;
    if (rearFull) renderer.shadowMap.needsUpdate = true;
    else this.gfx.render(dt);
    this.rearPip.render(renderer, this.gfx.scene);
    for (const pip of this.mirrorPips) pip.render(renderer, this.gfx.scene);
    if (this.rearPip.visible || (this.mirrorsEnabled && inCabin)) this.overlay.render(renderer);
    this.hud.setReverseCaption(this.rearPip.visible ? this.rearPip.rect : null);

    this.updateAudio(dt);
    this.updateFps(dt);
    const d = this.car.drivetrain;
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
  };

  private handleActions(): void {
    const i = this.input;
    if (i.consume('pause')) {
      this.paused = !this.paused;
      this.hud.setPaused(this.paused);
    }
    if (i.consume('reset')) {
      this.car.reset();
      this.rig.snap();
      this.accumulator = 0;
    }
    if (i.consume('selectorUp')) this.car.shiftSelector(-1);
    if (i.consume('selectorDown')) this.car.shiftSelector(1);
    if (i.consume('parkingBrake')) this.car.toggleParkingBrake();
    if (i.consume('autoHold')) this.car.toggleAutoHold();
    if (i.consume('ignition')) this.car.toggleIgnition();
    if (i.consume('indicatorLeft')) this.lights.toggleLeft();
    if (i.consume('indicatorRight')) this.lights.toggleRight();
    if (i.consume('hazards')) this.lights.toggleHazards();
    if (i.consume('lights')) this.lights.headlights = !this.lights.headlights;
    if (i.consume('mirrors')) this.mirrorsEnabled = !this.mirrorsEnabled;
    if (i.consume('camera')) this.rig.next();
    if (i.selectCamera >= 0) {
      const m = CAMERA_MODES[i.selectCamera];
      if (m) this.rig.setMode(m.id);
      i.selectCamera = -1;
    }
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
    a.update(
      {
        rpm: d.engineRpm,
        load: d.load,
        throttle: this.car.throttle,
        cranking: d.cranking,
        running: d.engineRunning,
        horn: this.input.horn,
        reverse: d.selector === 'R' && d.engineRunning,
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
