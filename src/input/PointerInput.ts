/**
 * Mouse / pen source for camera control: drag on the canvas to look around or
 * orbit, wheel to zoom. Deltas accumulate in InputState until the camera reads them.
 */

import type { InputState } from './InputState';

export class PointerInput {
  private dragging = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly state: InputState,
    target: HTMLElement,
  ) {
    target.addEventListener('pointerdown', this.onDown);
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerup', this.onUp);
    target.addEventListener('pointercancel', this.onUp);
    target.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.state.hadUserGesture = true;
    if (e.pointerType === 'touch') return; // touch controls arrive in Stage 7
    this.dragging = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragging) return;
    this.state.lookX += e.clientX - this.lastX;
    this.state.lookY += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.dragging) this.dragging = -1;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.state.zoom += Math.sign(e.deltaY);
  };
}
