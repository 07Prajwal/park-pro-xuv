/**
 * Right-hand-drive cabin: dashboard with the triple-screen panel (live digital
 * cluster on the driver's side), steering wheel that turns with the steering,
 * three rows of seats, centre console with the selector, headliner and IRVM.
 *
 * Frame: same as the body (+Z forward, +X left, footprint-centred). The driver
 * sits on the right, i.e. at negative X.
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Driver's eye point in the body frame. */
export const DRIVER_EYE = new THREE.Vector3(-0.37, 1.3, -0.17);
const WHEEL_CENTRE = new THREE.Vector3(-0.37, 0.98, 0.3);

export interface ClusterData {
  speedKmh: number;
  rpm: number;
  selector: string;
  gear: number;
  epb: boolean;
}

export interface CarInterior {
  group: THREE.Group;
  /** Rotates about its local Z (steering column) — radians, + = turned left. */
  steeringWheel: THREE.Group;
  /** Redraw the driver's digital cluster. */
  drawCluster(d: ClusterData): void;
  /** Glass of the interior rear-view mirror (faces the driver); gets the mirror image as its map. */
  mirrorGlass: THREE.Mesh;
}

/** Interior mirror centre in the body frame. */
export const INTERIOR_MIRROR = new THREE.Vector3(0, 1.43, 0.24);

export function buildInterior(cabinHalfWidth: number, roofY: number): CarInterior {
  const group = new THREE.Group();
  const soft = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.72 });
  const leather = new THREE.MeshStandardMaterial({ color: 0x3a2f28, roughness: 0.55 });
  const leatherDark = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.5 });
  const headliner = new THREE.MeshStandardMaterial({ color: 0xbdb7ae, roughness: 0.95 });
  const satin = new THREE.MeshStandardMaterial({ color: 0x9da2a8, metalness: 0.85, roughness: 0.3 });
  const piano = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.12, clearcoat: 1 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, r);

  // Dashboard: side profile extruded across the cabin, welded for smooth shading.
  const dash = new THREE.Shape();
  dash.moveTo(0.92, 1.05);
  dash.lineTo(0.92, 0.62);
  dash.lineTo(0.62, 0.56);
  dash.quadraticCurveTo(0.5, 0.6, 0.46, 0.8);
  dash.lineTo(0.43, 0.95);
  dash.quadraticCurveTo(0.41, 1.1, 0.52, 1.12);
  dash.lineTo(0.8, 1.1);
  dash.lineTo(0.92, 1.05);
  const dw = cabinHalfWidth * 2 - 0.02;
  const dashGeo = new THREE.ExtrudeGeometry(dash, { depth: dw - 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 12 });
  dashGeo.rotateY(-Math.PI / 2);
  dashGeo.translate((dw - 0.06) / 2, 0, 0);
  dashGeo.deleteAttribute('normal');
  dashGeo.deleteAttribute('uv');
  const dashSmooth = mergeVertices(dashGeo, 1e-4);
  dashSmooth.computeVertexNormals();
  add(dashSmooth, soft);
  add(rbox(dw - 0.1, 0.02, 0.04, 0.008), satin, 0, 0.9, 0.44); // trim strip

  // Triple-screen panel with a live cluster on the driver's side (viewer's right = -X).
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let ctx: CanvasRenderingContext2D | null = null;
  let tex: THREE.CanvasTexture | null = null;
  if (canvas) {
    canvas.width = 1024;
    canvas.height = 160;
    ctx = canvas.getContext('2d');
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.08,
    metalness: 0.2,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: tex ? 1.2 : 0,
  });
  const panelW = 1.15;
  add(rbox(panelW + 0.03, 0.16, 0.025, 0.01), piano, -0.12, 1.17, 0.5).rotation.x = 0.2;
  const screen = add(new THREE.PlaneGeometry(panelW, 0.135), screenMat, -0.12, 1.17, 0.486);
  screen.rotation.set(-0.2, Math.PI, 0);
  screen.castShadow = false;

  // Steering wheel: tilted column; the inner group spins with the steering.
  const column = new THREE.Group();
  column.position.copy(WHEEL_CENTRE);
  column.rotation.x = 0.38; // top of the rim leans towards the windscreen
  group.add(column);
  const steeringWheel = new THREE.Group();
  column.add(steeringWheel);
  const wheelPart = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    steeringWheel.add(m);
    return m;
  };
  wheelPart(new THREE.TorusGeometry(0.185, 0.019, 14, 56), leatherDark);
  const hub = wheelPart(new THREE.CylinderGeometry(0.07, 0.075, 0.06, 28), leatherDark, 0, -0.01, 0.01);
  hub.rotation.x = Math.PI / 2;
  const badge = wheelPart(new THREE.CylinderGeometry(0.025, 0.025, 0.01, 20), satin, 0, -0.01, -0.025);
  badge.rotation.x = Math.PI / 2;
  for (const [x, y, rz, len] of [
    [0.115, -0.015, 0.1, 0.11],
    [-0.115, -0.015, -0.1, 0.11],
    [0, -0.12, Math.PI / 2, 0.1],
  ]) {
    const s = wheelPart(rbox(len, 0.035, 0.022, 0.01), leatherDark, x, y, 0.005);
    s.rotation.z = rz;
  }
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 16), soft);
  col.rotation.x = Math.PI / 2;
  col.position.z = 0.17;
  column.add(col);

  // Seats: two front buckets, second-row bench, third-row bench.
  const seat = (x: number, z: number, w: number, backH: number, mat: THREE.Material) => {
    add(rbox(w, 0.13, 0.5, 0.05), mat, x, 0.64, z);
    const back = add(rbox(w, backH, 0.12, 0.05), mat, x, 0.66 + backH / 2, z - 0.26);
    back.rotation.x = -0.22;
    back.position.z -= Math.sin(0.22) * (backH / 2);
    const head = add(rbox(w * 0.55, 0.16, 0.09, 0.04), mat, x, 0.66 + backH + 0.1, z - 0.26 - Math.sin(0.22) * backH - 0.02);
    head.rotation.x = -0.12;
  };
  seat(-0.37, -0.2, 0.52, 0.66, leather);
  seat(0.37, -0.2, 0.52, 0.66, leather);
  seat(0, -1.12, 1.42, 0.6, leather);
  seat(0, -1.85, 1.2, 0.52, leather);

  // Centre console with the selector.
  add(rbox(0.24, 0.2, 0.75, 0.04), soft, 0, 0.66, 0.05);
  add(rbox(0.05, 0.08, 0.08, 0.02), piano, 0, 0.8, 0.22);
  add(rbox(0.2, 0.01, 0.3, 0.004), piano, 0, 0.765, 0.25);

  // Headliner and interior rear-view mirror.
  add(rbox(cabinHalfWidth * 1.7, 0.02, 2.2, 0.008), headliner, 0, roofY - 0.03, -1.0);
  add(rbox(0.26, 0.07, 0.03, 0.012), piano, INTERIOR_MIRROR.x, INTERIOR_MIRROR.y, INTERIOR_MIRROR.z);
  // Glass faces -Z (towards the driver); toneMapped like the rest of the scene.
  const mirrorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.055), new THREE.MeshBasicMaterial({ color: 0x222428 }));
  mirrorGlass.rotation.y = Math.PI;
  mirrorGlass.position.set(INTERIOR_MIRROR.x, INTERIOR_MIRROR.y, INTERIOR_MIRROR.z - 0.0165);
  group.add(mirrorGlass);

  function drawCluster(d: ClusterData): void {
    if (!ctx || !tex) return;
    const g = ctx;
    const W = canvas!.width;
    const H = canvas!.height;
    g.fillStyle = '#05070a';
    g.fillRect(0, 0, W, H);
    // Passenger / infotainment screens (viewer's left and centre): calm map-like gradient.
    const grad = g.createLinearGradient(0, 0, W * 0.64, H);
    grad.addColorStop(0, '#0d1a26');
    grad.addColorStop(1, '#13283a');
    g.fillStyle = grad;
    g.fillRect(8, 8, W * 0.31, H - 16);
    g.fillRect(W * 0.33 + 4, 8, W * 0.31, H - 16);
    g.fillStyle = '#5c87a8';
    g.font = '22px Arial, sans-serif';
    g.fillText('Navigation', W * 0.36, 40);
    // Driver cluster (viewer's right third).
    const x0 = W * 0.66 + 8;
    const cw = W * 0.34 - 16;
    g.fillStyle = '#0a0f14';
    g.fillRect(x0, 8, cw, H - 16);
    const frac = Math.min(d.rpm / 4800, 1);
    g.fillStyle = '#1f2a33';
    g.fillRect(x0 + 16, H - 34, cw - 32, 10);
    g.fillStyle = frac > 0.9 ? '#ff5252' : '#4fc3f7';
    g.fillRect(x0 + 16, H - 34, (cw - 32) * frac, 10);
    g.fillStyle = '#e8f1f8';
    g.font = 'bold 72px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(Math.round(Math.abs(d.speedKmh))), x0 + cw / 2, 92);
    g.font = '18px Arial, sans-serif';
    g.fillStyle = '#9fb3c4';
    g.fillText('km/h', x0 + cw / 2, 116);
    g.font = 'bold 34px Arial, sans-serif';
    g.fillStyle = '#4fc3f7';
    g.fillText(d.selector === 'D' && d.gear > 0 ? `D${d.gear}` : d.selector, x0 + 48, 86);
    if (d.epb) {
      g.fillStyle = '#ff5252';
      g.font = 'bold 22px Arial, sans-serif';
      g.fillText('(P)', x0 + cw - 44, 84);
    }
    g.textAlign = 'left';
    tex.needsUpdate = true;
  }

  return { group, steeringWheel, drawCluster, mirrorGlass };
}
