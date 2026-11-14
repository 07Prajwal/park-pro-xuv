/**
 * Top-level game: wires physics, rendering, input, camera and HUD together and
 * runs the main loop.
 *
 * Loop model: physics advances in fixed 1/60 s steps (accumulator); rendering
 * runs at display rate and interpolates the car between the last two physics
 * states, so motion stays smooth on 60/90/120 Hz displays and under frame jitter.
 */

import { PHYSICS, XUV_7XO, XUV_TUNING } from '../config';
import { ChaseCamera } from '../cameras/ChaseCamera';
import { InputState } from '../input/InputState';
import { KeyboardInput } from '../input/KeyboardInput';
import { Hud } from '../ui/Hud';
import { VehiclePhysics, type Spawn } from '../vehicle/VehiclePhysics';
import { VehicleVisual } from '../vehicle/VehicleVisual';
import { buildPracticeGround } from '../world/practiceGround';
import { createPhysics, type PhysicsContext } from './physics';
import { createRenderContext, type RenderContext } from './renderer';

const SPAWN: Spawn = { x: 0, z: -45, yaw: 0 };
/** Steering-wheel turns from centre to lock (≈ 1.5 turns, i.e. ~3 lock-to-lock). */
const STEERING_WHEEL_LOCK_DEG = 540;

export class Game {
  private readonly input = new InputState();
  private readonly keyboard: KeyboardInput;
  private readonly hud: Hud;
  private readonly chase: ChaseCamera;
  private readonly car: VehiclePhysics;
  private readonly carVisual: VehicleVisual;

  private accumulator = 0;
  private lastTime = -1;
  private paused = false;
  private fps = 60;
  private fpsFrames = 0;
  private fpsTime = 0;

  private constructor(
    private readonly phys: PhysicsContext,
    private readonly gfx: RenderContext,
    hudRoot: HTMLElement,
  ) {
    buildPracticeGround(gfx.scene, phys);

    this.car = new VehiclePhysics(phys.R, phys.world, XUV_7XO, XUV_TUNING, SPAWN);
    this.carVisual = new VehicleVisual(this.car);
    gfx.scene.add(this.carVisual.root);

    this.chase = new ChaseCamera(gfx.camera);
    this.keyboard = new KeyboardInput(this.input);
    this.hud = new Hud(hudRoot);

    window.addEventListener('resize', gfx.resize);
    // Don't simulate a huge catch-up step after the tab was hidden.
    document.addEventListener('visibilitychange', () => {
      this.lastTime = -1;
    });
  }

  static async create(canvas: HTMLCanvasElement, hudRoot: HTMLElement): Promise<Game> {
    const phys = await createPhysics();
    const gfx = createRenderContext(canvas);
    return new Game(phys, gfx, hudRoot);
  }

  start(): void {
    this.gfx.renderer.setAnimationLoop(this.frame);
  }

  private readonly frame = (timeMs: number): void => {
    const now = timeMs / 1000;
    const dt = this.lastTime < 0 ? 0 : Math.min(now - this.lastTime, 0.25);
    this.lastTime = now;

    this.keyboard.poll();
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
    }

    const alpha = this.accumulator / PHYSICS.fixedDt;
    this.carVisual.update(alpha);
    this.chase.update(this.carVisual.root, dt);
    this.gfx.followShadow(this.carVisual.root.position.x, this.carVisual.root.position.z);
    this.gfx.renderer.render(this.gfx.scene, this.gfx.camera);

    this.updateFps(dt);
    this.hud.update(
      {
        speedKmh: this.car.speedKmh,
        gear: this.car.gear,
        steerDeg: this.car.steerPosition * STEERING_WHEEL_LOCK_DEG,
        handbrake: this.input.handbrake,
        fps: this.fps,
      },
      dt,
    );
  };

  private handleActions(): void {
    if (this.input.consume('pause')) {
      this.paused = !this.paused;
      this.hud.setPaused(this.paused);
    }
    if (this.input.consume('reset')) {
      this.car.reset();
      this.chase.snap();
      this.accumulator = 0;
    }
    this.input.consume('camera'); // Camera switching arrives in Stage 3.
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
