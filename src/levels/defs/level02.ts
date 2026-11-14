import type { Difficulty, Gate, LevelDef, LevelLayout } from '../types';
import { emptyLayout, LINE_W } from './common';

/** Level 2: cone slalom, a U-turn at the far end and a return lane. */
function coneCourse(d: Difficulty): LevelLayout {
  const L = emptyLayout();
  const spacing = { beginner: 9, normal: 7.5, hard: 6.5 }[d];
  const depth = { beginner: 13, normal: 11, hard: 9.5 }[d];
  const z0 = -30;
  const n = 6;
  const gates: Gate[] = [];
  for (let i = 0; i < n; i++) {
    const z = z0 + i * spacing;
    L.cones.push({ x: 0, z });
    const side = i % 2 === 0 ? -1 : 1;
    gates.push({ rect: { x: side * 1.9, z, yaw: 0, w: 3, l: 1.2 }, label: `Cone ${i + 1}: pass on the ${side < 0 ? 'right' : 'left'}` });
  }
  const zLast = z0 + (n - 1) * spacing;
  const zFar = zLast + depth;
  // Turn-around area: a cone wall at the far end, and the return lane 9 m to the left.
  for (let x = -4; x <= 13; x += 1.5) L.cones.push({ x, z: zFar });
  gates.push({ rect: { x: 4.2, z: zFar - 3.5, yaw: 0, w: 8.4, l: 7 }, label: 'Make a U-turn to the left without touching the far cones' });
  const laneX = 9;
  for (let z = z0 - 4; z <= zLast; z += 5) {
    L.cones.push({ x: laneX - 2.4, z }, { x: laneX + 2.4, z });
  }
  gates.push({ rect: { x: laneX, z: z0 - 4, yaw: 0, w: 4.4, l: 1.5 }, label: 'Return through the lane to the finish' });
  L.gates = gates;
  L.lines.push({ x: 0, z: z0 - 8, yaw: 0, w: 3, l: LINE_W }, { x: laneX, z: z0 - 6, yaw: 0, w: 4.8, l: LINE_W });
  L.spawn = { x: 0, z: z0 - 14, yaw: 0 };
  L.parTimeS = { beginner: 70, normal: 60, hard: 50 }[d];
  return L;
}

export const level02: LevelDef = {
  id: 2,
  title: 'Cone slalom and U-turn',
  summary: 'Weave through the cones, make a U-turn at the far end and come back through the return lane.',
  technique: [
    'Pass each cone on the side shown by the gate markers, without touching any cone.',
    'Slow down before the far end: a U-turn needs about 11 m kerb to kerb in the XUV.',
    'Turn fully left early and return through the lane to the finish line.',
  ],
  build: coneCourse,
};
