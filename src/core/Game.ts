/**
 * Top-level game: loads assets, wires physics, rendering, input, audio, camera
 * and HUD together and runs the main loop.
 *
 * Loop model: physics advances in fixed 1/60 s steps (accumulator); rendering
 * runs at display rate and interpolates the car between the last two physics
 * states, so motion stays smooth on 60/90/120 Hz displays and under frame jitter.
 */

import { PAINT_COLOURS, PHYSICS, XUV_7XO, XUV_DRIVETRAIN, XUV_TUNING } from '../config';
import { AudioEngine } from '../audio/AudioEngine';
import { ChaseCamera } from '../cameras/ChaseCamera';
import { InputState } from '../input/InputState';
import { KeyboardInput } from '../input/KeyboardInput';
import { Hud } from '../ui/Hud';
import { VehicleLights } from '../vehicle/VehicleLights';
import { VehiclePhysics, type Spawn } from '../vehicle/VehiclePhysics';
import { VehicleVisual } from '../vehicle/VehicleVisual';
import { buildPracticeGround } from '../world/practiceGround';
import { loadAssets } from './assets';
import { createPhysics, type PhysicsContext } from './physics';
import { pickQuality } from './quality';
import { createRenderContext, createRenderer, type RenderContext } from './renderer';

const SPAWN: Spawn = { x: 0, z: -55, yaw: 0 };
/** Steering-wheel turns from centre to lock (≈ 1.5 turns, i.e. ~3 lock-to-lock). */
const STEERING_WHEEL_LOCK_DEG = 540;

export class Game {
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly hud: Hud;
  private readonly chase: ChaseCamera;
  private readonly car: VehiclePhysics;
  private readonly lights = new VehicleLights();
  private readonly carVisual: VehicleVisual;
  private audio: AudioEngine | null = null;
  private audioStarting = false;

  private accumulator = 0;
  private lastTime = -1;
  private paused = false;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastSelector = 'P';

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

    this.chase = new ChaseCamera(gfx.camera);
    this.keyboard = new KeyboardInput(this.input, XUV_TUNING.pedals);
    this.hud = new Hud(hudRoot);

    window.addEventListener('resize', gfx.resize);
    window.addEventListener('pointerdown', () => (this.input.hadUserGesture = true));
    // Don't simulate a huge catch-up step after the tab was hidden.
    document.addEventListener('visibilitychange', () => {
      this.lastTime = -1;
    });
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
    this.carVisual.update(alpha);
    this.chase.update(this.carVisual.root, dt);
    this.gfx.followShadow(this.carVisual.root.position.x, this.carVisual.root.position.z);
    this.gfx.render(dt);

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
        steerDeg: this.car.steerPosition * STEERING_WHEEL_LOCK_DEG,
        fps: this.fps,
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
      this.chase.snap();
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
    i.consume('camera'); // Camera switching arrives in Stage 3.
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
