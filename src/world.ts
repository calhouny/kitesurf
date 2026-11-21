import * as THREE from 'three';
import {
  GameMode,
  ObstacleItem,
  ObstacleType,
  PhysicsState,
  WaveHeightFn,
  WorldEvent,
} from './types';

const CHUNK_LENGTH = 90;
const SPAWN_AHEAD_DISTANCE = 380;
const RECYCLE_BEHIND_DISTANCE = 65;
const RECYCLE_LATERAL_DISTANCE = 155;
const CORRIDOR_HALF_WIDTH = 44;

function distToSegmentSq2D(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const vx = bx - ax;
  const vz = bz - az;
  const lenSq = vx * vx + vz * vz;
  if (lenSq <= 1e-6) {
    const dx = px - ax;
    const dz = pz - az;
    return dx * dx + dz * dz;
  }
  const t = THREE.MathUtils.clamp(((px - ax) * vx + (pz - az) * vz) / lenSq, 0, 1);
  const dx = px - (ax + vx * t);
  const dz = pz - (az + vz * t);
  return dx * dx + dz * dz;
}

function distToSegmentSq3D(
  px: number,
  py: number,
  pz: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const vz = bz - az;
  const lenSq = vx * vx + vy * vy + vz * vz;
  if (lenSq <= 1e-6) {
    const dx = px - ax;
    const dy = py - ay;
    const dz = pz - az;
    return dx * dx + dy * dy + dz * dz;
  }
  const t = THREE.MathUtils.clamp(
    ((px - ax) * vx + (py - ay) * vy + (pz - az) * vz) / lenSq,
    0,
    1
  );
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  const dz = pz - (az + vz * t);
  return dx * dx + dy * dy + dz * dz;
}

interface InternalObstacle {
  item: ObstacleItem;
  mesh: THREE.Group;
  baseX: number;
  baseAltitude: number;
  phase: number;
  patrolSpeed: number;
  patrolWidth: number;
  flashTimer: number;
  gateId?: number;
}

interface InternalCoin {
  id: number;
  mesh: THREE.Group;
  position: THREE.Vector3;
  baseAltitude: number;
  phase: number;
  collected: boolean;
}

interface SlalomGate {
  id: number;
  z: number;
  centerX: number;
  left: InternalObstacle;
  right: InternalObstacle;
  cleared: boolean;
}

interface SharedWorldAssets {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  rampDeckGeo: THREE.BufferGeometry;
  rampPontoonGeo: THREE.BufferGeometry;
  rampLipGeo: THREE.BufferGeometry;
  rampStripeGeo: THREE.BufferGeometry;
  buoyBaseGeo: THREE.BufferGeometry;
  buoyBodyGeo: THREE.BufferGeometry;
  buoyBandGeo: THREE.BufferGeometry;
  buoyPoleGeo: THREE.BufferGeometry;
  buoyFlagGeo: THREE.BufferGeometry;
  buoyBeaconGeo: THREE.BufferGeometry;
  ringOuterGeo: THREE.BufferGeometry;
  ringInnerGeo: THREE.BufferGeometry;
  ringFinGeo: THREE.BufferGeometry;
  gustColumnGeo: THREE.BufferGeometry;
  gustSwirlGeo: THREE.BufferGeometry;
  gustStreakGeo: THREE.BufferGeometry;
  coinDiscGeo: THREE.BufferGeometry;
  coinEmblemGeo: THREE.BufferGeometry;
  barrelBodyGeo: THREE.BufferGeometry;
  barrelBandGeo: THREE.BufferGeometry;
  sharkFinGeo: THREE.BufferGeometry;
  sharkWakeGeo: THREE.BufferGeometry;

  rampDeckMat: THREE.MeshStandardMaterial;
  rampSideMat: THREE.MeshStandardMaterial;
  rampLipMat: THREE.MeshStandardMaterial;
  rampStripeMat: THREE.MeshStandardMaterial;
  buoyLeftMat: THREE.MeshStandardMaterial;
  buoyRightMat: THREE.MeshStandardMaterial;
  buoyWhiteMat: THREE.MeshStandardMaterial;
  buoyPoleMat: THREE.MeshStandardMaterial;
  buoyLeftGlowMat: THREE.MeshStandardMaterial;
  buoyRightGlowMat: THREE.MeshStandardMaterial;
  ringGoldMat: THREE.MeshStandardMaterial;
  ringNeonMat: THREE.MeshStandardMaterial;
  gustColumnMat: THREE.MeshStandardMaterial;
  gustSwirlMat: THREE.MeshStandardMaterial;
  coinGoldMat: THREE.MeshStandardMaterial;
  coinEmblemMat: THREE.MeshStandardMaterial;
  barrelOrangeMat: THREE.MeshStandardMaterial;
  barrelBandMat: THREE.MeshStandardMaterial;
  sharkFinMat: THREE.MeshStandardMaterial;
  sharkWakeMat: THREE.MeshStandardMaterial;
}

/**
 * Builds a closed curved kicker ramp geometry.
 * Entry is at +Z (submerged slightly below waterline), launch lip is at -Z (+height).
 */
function createKickerGeometry(width: number, length: number, height: number, segments = 8): THREE.BufferGeometry {
  const halfW = width * 0.5;
  const halfL = length * 0.5;
  const bottomY = -0.55;

  const positions: number[] = [];
  const normals: number[] = [];

  const pushTri = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number
  ): void => {
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  };

  const pushQuad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number
  ): void => {
    pushTri(ax, ay, az, bx, by, bz, cx, cy, cz);
    pushTri(ax, ay, az, cx, cy, cz, dx, dy, dz);
  };

  const surfaceY = (t: number): number => -0.22 + (height + 0.22) * Math.pow(t, 1.45);
  const surfaceZ = (t: number): number => halfL - t * length;

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const z0 = surfaceZ(t0);
    const z1 = surfaceZ(t1);
    const y0 = surfaceY(t0);
    const y1 = surfaceY(t1);

    // Top curved deck (+Y normal)
    pushQuad(-halfW, y0, z0, halfW, y0, z0, halfW, y1, z1, -halfW, y1, z1);
    // Left side wall (-X normal)
    pushQuad(-halfW, bottomY, z0, -halfW, y0, z0, -halfW, y1, z1, -halfW, bottomY, z1);
    // Right side wall (+X normal)
    pushQuad(halfW, y0, z0, halfW, bottomY, z0, halfW, bottomY, z1, halfW, y1, z1);
    // Underside (-Y normal)
    pushQuad(halfW, bottomY, z0, -halfW, bottomY, z0, -halfW, bottomY, z1, halfW, bottomY, z1);
  }

  // Back vertical face at -Z lip
  const lipY = surfaceY(1);
  pushQuad(-halfW, bottomY, -halfL, -halfW, lipY, -halfL, halfW, lipY, -halfL, halfW, bottomY, -halfL);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geo;
}

function createSharkFinGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-1.1, 0);
  shape.quadraticCurveTo(-0.3, 0.9, 0.35, 1.45);
  shape.quadraticCurveTo(0.25, 0.6, 0.65, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 2,
  });
  // Center thickness around X=0 and align chord along Z
  geo.translate(0, 0, -0.09);
  geo.rotateY(Math.PI * 0.5);
  return geo;
}

function createPennantFlagGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.55);
  shape.lineTo(1.25, 0.25);
  shape.lineTo(0, -0.05);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function createSharedAssets(): SharedWorldAssets {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const rampDeckGeo = trackGeo(createKickerGeometry(6.6, 10.6, 2.85, 8));
  const rampPontoonGeo = trackGeo(new THREE.CylinderGeometry(0.45, 0.45, 10.2, 10));
  rampPontoonGeo.rotateX(Math.PI * 0.5);
  const rampLipGeo = trackGeo(new THREE.BoxGeometry(6.75, 0.22, 0.35));
  const rampStripeGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.08, 0.5));

  const buoyBaseGeo = trackGeo(new THREE.CylinderGeometry(1.05, 1.25, 0.55, 14));
  const buoyBodyGeo = trackGeo(new THREE.CylinderGeometry(0.55, 0.92, 1.5, 14));
  const buoyBandGeo = trackGeo(new THREE.CylinderGeometry(0.72, 0.78, 0.32, 14));
  const buoyPoleGeo = trackGeo(new THREE.CylinderGeometry(0.08, 0.09, 2.3, 8));
  const buoyFlagGeo = trackGeo(createPennantFlagGeometry());
  const buoyBeaconGeo = trackGeo(new THREE.SphereGeometry(0.22, 10, 10));

  const ringOuterGeo = trackGeo(new THREE.TorusGeometry(4.2, 0.32, 12, 36));
  const ringInnerGeo = trackGeo(new THREE.TorusGeometry(3.75, 0.09, 8, 36));
  const ringFinGeo = trackGeo(new THREE.BoxGeometry(0.32, 1.1, 0.55));

  const gustColumnGeo = trackGeo(new THREE.CylinderGeometry(4.2, 2.9, 17.0, 20, 1, true));
  const gustSwirlGeo = trackGeo(new THREE.TorusGeometry(3.4, 0.14, 8, 28));
  gustSwirlGeo.rotateX(Math.PI * 0.5);
  const gustStreakGeo = trackGeo(new THREE.BoxGeometry(0.14, 3.2, 0.14));

  const coinDiscGeo = trackGeo(new THREE.CylinderGeometry(0.95, 0.95, 0.22, 20));
  coinDiscGeo.rotateX(Math.PI * 0.5);
  const coinEmblemGeo = trackGeo(new THREE.OctahedronGeometry(0.45, 0));
  coinEmblemGeo.scale(0.85, 1.15, 0.4);

  const barrelBodyGeo = trackGeo(new THREE.CylinderGeometry(0.82, 0.82, 2.1, 14));
  const barrelBandGeo = trackGeo(new THREE.CylinderGeometry(0.86, 0.86, 0.22, 14));

  const sharkFinGeo = trackGeo(createSharkFinGeometry());
  const sharkWakeGeo = trackGeo(new THREE.RingGeometry(0.55, 1.15, 18));
  sharkWakeGeo.rotateX(-Math.PI * 0.5);

  const rampDeckMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xd98a3c,
      roughness: 0.55,
      metalness: 0.1,
    })
  );
  const rampSideMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff3b30,
      roughness: 0.4,
      metalness: 0.25,
      emissive: 0x330800,
      emissiveIntensity: 0.25,
    })
  );
  const rampLipMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x00f5ff,
      emissive: 0x00d9ff,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    })
  );
  const rampStripeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff8e7,
      emissive: 0xffd166,
      emissiveIntensity: 0.35,
      roughness: 0.35,
    })
  );

  const buoyLeftMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff2a44,
      roughness: 0.35,
      metalness: 0.15,
      emissive: 0x550011,
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    })
  );
  const buoyRightMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x00e676,
      roughness: 0.35,
      metalness: 0.15,
      emissive: 0x004422,
      emissiveIntensity: 0.25,
      side: THREE.DoubleSide,
    })
  );
  const buoyWhiteMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      emissive: 0xffffff,
      emissiveIntensity: 0.15,
    })
  );
  const buoyPoleMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.7,
      roughness: 0.25,
    })
  );
  const buoyLeftGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff4d6d,
      emissive: 0xff1e42,
      emissiveIntensity: 1.0,
    })
  );
  const buoyRightGlowMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x38ff9c,
      emissive: 0x00e676,
      emissiveIntensity: 1.0,
    })
  );

  const ringGoldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.55,
      roughness: 0.2,
      emissive: 0xff9f1c,
      emissiveIntensity: 0.75,
    })
  );
  const ringNeonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x70f8ff,
      emissive: 0x00f0ff,
      emissiveIntensity: 1.15,
      roughness: 0.15,
    })
  );

  const gustColumnMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xb8f8ff,
      emissive: 0x56cfe1,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const gustSwirlMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe0fbfc,
      emissive: 0x72efdd,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
  );

  const coinGoldMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffd166,
      metalness: 0.75,
      roughness: 0.22,
      emissive: 0xffa600,
      emissiveIntensity: 0.4,
    })
  );
  const coinEmblemMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xfff3b0,
      metalness: 0.65,
      roughness: 0.2,
      emissive: 0xffd166,
      emissiveIntensity: 0.55,
    })
  );

  const barrelOrangeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xff5400,
      roughness: 0.55,
      metalness: 0.35,
      emissive: 0x3a1200,
      emissiveIntensity: 0.2,
    })
  );
  const barrelBandMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x1b1f23,
      roughness: 0.45,
      metalness: 0.6,
    })
  );

  const sharkFinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x263238,
      roughness: 0.35,
      metalness: 0.25,
    })
  );
  const sharkWakeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xd0f4ff,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );

  return {
    geometries,
    materials,
    rampDeckGeo,
    rampPontoonGeo,
    rampLipGeo,
    rampStripeGeo,
    buoyBaseGeo,
    buoyBodyGeo,
    buoyBandGeo,
    buoyPoleGeo,
    buoyFlagGeo,
    buoyBeaconGeo,
    ringOuterGeo,
    ringInnerGeo,
    ringFinGeo,
    gustColumnGeo,
    gustSwirlGeo,
    gustStreakGeo,
    coinDiscGeo,
    coinEmblemGeo,
    barrelBodyGeo,
    barrelBandGeo,
    sharkFinGeo,
    sharkWakeGeo,
    rampDeckMat,
    rampSideMat,
    rampLipMat,
    rampStripeMat,
    buoyLeftMat,
    buoyRightMat,
    buoyWhiteMat,
    buoyPoleMat,
    buoyLeftGlowMat,
    buoyRightGlowMat,
    ringGoldMat,
    ringNeonMat,
    gustColumnMat,
    gustSwirlMat,
    coinGoldMat,
    coinEmblemMat,
    barrelOrangeMat,
    barrelBandMat,
    sharkFinMat,
    sharkWakeMat,
  };
}

export class WorldManager {
  private readonly scene: THREE.Scene;
  private readonly worldGroup: THREE.Group;
  private readonly assets: SharedWorldAssets;

  private readonly obstaclePools: Record<ObstacleType, THREE.Group[]>;
  private readonly coinPool: THREE.Group[] = [];

  private activeObstacles: InternalObstacle[] = [];
  private activeCoins: InternalCoin[] = [];
  private gates: SlalomGate[] = [];

  private nextObstacleId = 1;
  private nextCoinId = 1;
  private nextGateId = 1;

  private nextChunkZ = -35;
  private corridorCenterX = 0;
  private chunkIndex = 0;
  private slalomGateCounter = 0;
  private rngState = 1337;
  private prevPlayerX: number | null = null;
  private prevPlayerY: number | null = null;
  private prevPlayerZ: number | null = null;
  private currentMode: GameMode = 'ENDLESS';

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.worldGroup = new THREE.Group();
    this.worldGroup.name = 'WorldManagerGroup';
    this.scene.add(this.worldGroup);

    this.assets = createSharedAssets();
    this.obstaclePools = {
      RAMP: [],
      BUOY_LEFT: [],
      BUOY_RIGHT: [],
      RING: [],
      FLOATING_BARREL: [],
      SHARK_FIN: [],
      WIND_GUST: [],
    };

    this.reset('ENDLESS');
  }

  private rand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 4294967296;
  }

  private randRange(min: number, max: number): number {
    return min + (max - min) * this.rand();
  }

  private buildObstacleMesh(type: ObstacleType): THREE.Group {
    const group = new THREE.Group();
    const a = this.assets;

    switch (type) {
      case 'RAMP': {
        const deck = new THREE.Mesh(a.rampDeckGeo, a.rampDeckMat);
        deck.castShadow = true;
        deck.receiveShadow = true;
        group.add(deck);

        for (const side of [-1, 1]) {
          const pontoon = new THREE.Mesh(a.rampPontoonGeo, a.rampSideMat);
          pontoon.position.set(side * 3.35, -0.15, 0);
          pontoon.castShadow = true;
          group.add(pontoon);
        }

        const lip = new THREE.Mesh(a.rampLipGeo, a.rampLipMat);
        lip.position.set(0, 2.86, -5.2);
        group.add(lip);

        // Sport launch stripes rising up the ramp deck
        const stripePositions: Array<[number, number, number]> = [
          [0, 0.35, 2.2],
          [0, 1.15, -0.5],
          [0, 2.05, -3.1],
        ];
        for (const [sx, sy, sz] of stripePositions) {
          const stripe = new THREE.Mesh(a.rampStripeGeo, a.rampStripeMat);
          stripe.position.set(sx, sy, sz);
          stripe.rotation.x = -0.3;
          group.add(stripe);
        }
        break;
      }

      case 'BUOY_LEFT':
      case 'BUOY_RIGHT': {
        const bodyMat = type === 'BUOY_LEFT' ? a.buoyLeftMat : a.buoyRightMat;
        const glowMat = type === 'BUOY_LEFT' ? a.buoyLeftGlowMat : a.buoyRightGlowMat;

        const base = new THREE.Mesh(a.buoyBaseGeo, bodyMat);
        base.position.y = 0.05;
        base.castShadow = true;
        group.add(base);

        const body = new THREE.Mesh(a.buoyBodyGeo, bodyMat);
        body.position.y = 0.95;
        body.castShadow = true;
        group.add(body);

        const band = new THREE.Mesh(a.buoyBandGeo, a.buoyWhiteMat);
        band.position.y = 1.15;
        group.add(band);

        const pole = new THREE.Mesh(a.buoyPoleGeo, a.buoyPoleMat);
        pole.position.y = 2.6;
        group.add(pole);

        const flag = new THREE.Mesh(a.buoyFlagGeo, bodyMat);
        flag.position.set(0, 3.15, 0);
        flag.rotation.y = type === 'BUOY_LEFT' ? 0 : Math.PI;
        group.add(flag);

        const beacon = new THREE.Mesh(a.buoyBeaconGeo, glowMat);
        beacon.position.y = 3.85;
        group.add(beacon);
        break;
      }

      case 'RING': {
        const outer = new THREE.Mesh(a.ringOuterGeo, a.ringGoldMat);
        outer.castShadow = true;
        group.add(outer);

        const inner = new THREE.Mesh(a.ringInnerGeo, a.ringNeonMat);
        group.add(inner);

        for (let i = 0; i < 4; i++) {
          const fin = new THREE.Mesh(a.ringFinGeo, a.ringNeonMat);
          const angle = (i * Math.PI) / 2;
          fin.position.set(Math.cos(angle) * 4.55, Math.sin(angle) * 4.55, 0);
          fin.rotation.z = angle + Math.PI * 0.5;
          group.add(fin);
        }
        break;
      }

      case 'WIND_GUST': {
        const column = new THREE.Mesh(a.gustColumnGeo, a.gustColumnMat);
        column.position.y = 8.5;
        group.add(column);

        for (let i = 0; i < 4; i++) {
          const swirl = new THREE.Mesh(a.gustSwirlGeo, a.gustSwirlMat);
          swirl.position.y = 1.5 + i * 4.0;
          swirl.scale.setScalar(0.85 + i * 0.12);
          swirl.rotation.z = i % 2 === 0 ? 0.12 : -0.12;
          swirl.userData.swirlIndex = i;
          group.add(swirl);
        }

        for (let i = 0; i < 6; i++) {
          const streak = new THREE.Mesh(a.gustStreakGeo, a.gustSwirlMat);
          const angle = (i / 6) * Math.PI * 2;
          streak.position.set(Math.cos(angle) * 2.9, 2.5 + (i % 3) * 4.5, Math.sin(angle) * 2.9);
          streak.userData.streakIndex = i;
          group.add(streak);
        }
        break;
      }

      case 'FLOATING_BARREL': {
        const barrel = new THREE.Mesh(a.barrelBodyGeo, a.barrelOrangeMat);
        barrel.rotation.z = Math.PI * 0.42;
        barrel.position.y = 0.28;
        barrel.castShadow = true;
        group.add(barrel);

        for (const offset of [-0.55, 0.55]) {
          const band = new THREE.Mesh(a.barrelBandGeo, a.barrelBandMat);
          band.position.y = offset;
          barrel.add(band);
        }
        break;
      }

      case 'SHARK_FIN': {
        const fin = new THREE.Mesh(a.sharkFinGeo, a.sharkFinMat);
        fin.position.y = -0.1;
        fin.castShadow = true;
        group.add(fin);

        const wake = new THREE.Mesh(a.sharkWakeGeo, a.sharkWakeMat);
        wake.position.y = 0.08;
        group.add(wake);
        break;
      }
    }

    this.worldGroup.add(group);
    return group;
  }

  private buildCoinMesh(): THREE.Group {
    const group = new THREE.Group();
    const disc = new THREE.Mesh(this.assets.coinDiscGeo, this.assets.coinGoldMat);
    disc.castShadow = true;
    group.add(disc);

    const emblem = new THREE.Mesh(this.assets.coinEmblemGeo, this.assets.coinEmblemMat);
    emblem.position.z = 0.04;
    group.add(emblem);

    const emblemBack = new THREE.Mesh(this.assets.coinEmblemGeo, this.assets.coinEmblemMat);
    emblemBack.position.z = -0.04;
    group.add(emblemBack);

    this.worldGroup.add(group);
    return group;
  }

  private acquireObstacleMesh(type: ObstacleType): THREE.Group {
    const pool = this.obstaclePools[type];
    const mesh = pool.length > 0 ? pool.pop()! : this.buildObstacleMesh(type);
    mesh.visible = true;
    mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, 0, 0);
    return mesh;
  }

  private releaseObstacleMesh(type: ObstacleType, mesh: THREE.Group): void {
    mesh.visible = false;
    this.obstaclePools[type].push(mesh);
  }

  private acquireCoinMesh(): THREE.Group {
    const mesh = this.coinPool.length > 0 ? this.coinPool.pop()! : this.buildCoinMesh();
    mesh.visible = true;
    mesh.scale.set(1, 1, 1);
    mesh.rotation.set(0, 0, 0);
    return mesh;
  }

  private releaseCoinMesh(mesh: THREE.Group): void {
    mesh.visible = false;
    this.coinPool.push(mesh);
  }

  private spawnObstacle(
    type: ObstacleType,
    x: number,
    baseAltitude: number,
    z: number,
    radius: number,
    options?: { patrolSpeed?: number; patrolWidth?: number; gateId?: number }
  ): InternalObstacle {
    const mesh = this.acquireObstacleMesh(type);
    mesh.position.set(x, baseAltitude, z);

    const entry: InternalObstacle = {
      item: {
        id: this.nextObstacleId++,
        type,
        position: new THREE.Vector3(x, baseAltitude, z),
        radius,
        active: true,
        passed: false,
      },
      mesh,
      baseX: x,
      baseAltitude,
      phase: this.randRange(0, Math.PI * 2),
      patrolSpeed: options?.patrolSpeed ?? 0,
      patrolWidth: options?.patrolWidth ?? 0,
      flashTimer: 0,
      gateId: options?.gateId,
    };

    this.activeObstacles.push(entry);
    return entry;
  }

  private spawnCoin(x: number, baseAltitude: number, z: number): InternalCoin {
    const mesh = this.acquireCoinMesh();
    mesh.position.set(x, baseAltitude, z);

    const coin: InternalCoin = {
      id: this.nextCoinId++,
      mesh,
      position: new THREE.Vector3(x, baseAltitude, z),
      baseAltitude,
      phase: this.randRange(0, Math.PI * 2),
      collected: false,
    };

    this.activeCoins.push(coin);
    return coin;
  }

  private spawnCoinLine(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    count: number,
    arcPeakHeight = 0,
    baseAlt = 1.25,
    halfArc = false
  ): void {
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = startX + (endX - startX) * t;
      const z = startZ + (endZ - startZ) * t;
      const arcAngle = halfArc ? t * Math.PI * 0.5 : t * Math.PI;
      const arc = arcPeakHeight > 0 ? Math.sin(arcAngle) * arcPeakHeight : 0;
      this.spawnCoin(x, baseAlt + arc, z);
    }
  }

  private spawnRampSet(
    x: number,
    z: number,
    withRing: boolean,
    ringAlt: number,
    withGustAfter: boolean
  ): void {
    this.spawnObstacle('RAMP', x, 0, z, 3.6);

    // Parabolic coin arc off the kicker launch lip into the sky-ring
    const lipZ = z - 6.5;
    if (withRing) {
      this.spawnCoinLine(x, lipZ, x, z - 31, 5, ringAlt - 3.2, 3.2, true);
      this.spawnObstacle('RING', x, ringAlt, z - 31, 4.3);
    } else {
      this.spawnCoinLine(x, lipZ, x, z - 24, 5, 7.5, 3.0, false);
    }

    if (withGustAfter) {
      const gustX = x + this.randRange(-9, 9);
      this.spawnObstacle('WIND_GUST', gustX, 0, z - 44, 4.4);
    }
  }

  private spawnSlalomGate(centerX: number, z: number, width: number, coinTrail = true): void {
    const halfW = width * 0.5;
    const gateId = this.nextGateId++;
    const left = this.spawnObstacle('BUOY_LEFT', centerX - halfW, 0, z, 1.15, { gateId });
    const right = this.spawnObstacle('BUOY_RIGHT', centerX + halfW, 0, z, 1.15, { gateId });

    this.gates.push({
      id: gateId,
      z,
      centerX,
      left,
      right,
      cleared: false,
    });

    if (coinTrail) {
      this.spawnCoinLine(centerX, z + 10, centerX, z - 8, 4, 0, 1.25);
    }
  }

  private spawnHazard(x: number, z: number, difficulty: number): void {
    const isShark = this.rand() < 0.45 + Math.min(0.25, difficulty * 0.03);
    if (isShark) {
      const patrolWidth = this.randRange(4.0, 8.5);
      const patrolSpeed = this.randRange(1.2, 2.2);
      this.spawnObstacle('SHARK_FIN', x, 0, z, 1.3, { patrolWidth, patrolSpeed });
    } else {
      this.spawnObstacle('FLOATING_BARREL', x, 0, z, 1.35);
    }
  }

  private generateChunk(chunkStartZ: number, playerX: number, mode: GameMode): void {
    this.corridorCenterX = playerX;

    const cx = this.corridorCenterX;
    const difficulty = Math.min(10, this.chunkIndex * 0.35);
    const z1 = chunkStartZ - 22;
    const z2 = chunkStartZ - 54;
    const z3 = chunkStartZ - 78;

    switch (mode) {
      case 'BIG_AIR': {
        const rampX = cx + this.randRange(-18, 18);
        const ringAlt = this.randRange(13, 23);
        this.spawnRampSet(rampX, z1, true, ringAlt, true);

        // Standalone high sky-ring in opposite lane for kite-only pop
        const altLaneX = cx + (rampX > cx ? -18 : 18) + this.randRange(-6, 6);
        this.spawnObstacle('RING', altLaneX, this.randRange(14, 24), z3, 4.4);
        this.spawnObstacle('WIND_GUST', altLaneX, 0, z2 + 8, 4.5);

        if (this.chunkIndex % 2 === 1) {
          const hazardX = cx + (rampX > cx ? -28 : 28);
          this.spawnHazard(hazardX, z2, difficulty);
        }
        break;
      }

      case 'SLALOM': {
        for (let g = 0; g < 2; g++) {
          const gz = chunkStartZ - (g === 0 ? 22 : 67);
          const gateWidth = Math.max(12.5, 17.5 - difficulty * 0.35);
          const swing = Math.sin(this.slalomGateCounter * 0.95) * 20;
          const gateX = cx + swing;
          this.spawnSlalomGate(gateX, gz, gateWidth, true);
          this.slalomGateCounter++;

          // Hazard outside the gate corridor to reward clean lines
          if (this.rand() < 0.7) {
            const side = swing >= 0 ? -1 : 1;
            this.spawnHazard(gateX + side * (gateWidth * 0.9 + 8), gz - 10, difficulty);
          }
        }

        if (this.chunkIndex % 2 === 0) {
          const sideX = cx + (Math.sin(this.slalomGateCounter) >= 0 ? -24 : 24);
          this.spawnObstacle('WIND_GUST', sideX, 0, z2, 4.2);
        }
        break;
      }

      case 'FREESTYLE': {
        const laneA = cx + this.randRange(-22, -4);
        const laneB = cx + this.randRange(4, 22);

        this.spawnRampSet(laneA, z1, this.rand() < 0.7, this.randRange(11, 20), false);
        this.spawnObstacle('WIND_GUST', laneB, 0, z2, 4.5);
        this.spawnObstacle('RING', laneB, this.randRange(12, 21), z3, 4.3);

        // Sweeping coin ribbon across water
        this.spawnCoinLine(laneB, z1 + 8, laneA, z3, 6, 0, 1.3);

        if (this.rand() < 0.55) {
          this.spawnHazard(cx + this.randRange(-28, 28), z3 - 6, difficulty);
        }
        break;
      }

      case 'ENDLESS':
      default: {
        const pattern = this.chunkIndex % 3;
        if (pattern === 0) {
          const rampX = cx + this.randRange(-18, 18);
          this.spawnRampSet(rampX, z1, true, this.randRange(12, 21), false);

          const otherX = cx + (rampX > cx ? -20 : 20);
          this.spawnCoinLine(otherX, z1, otherX + this.randRange(-6, 6), z3, 5, 0, 1.25);
          this.spawnHazard(otherX, z2, difficulty);
        } else if (pattern === 1) {
          const gateX = cx + this.randRange(-14, 14);
          this.spawnSlalomGate(gateX, z1, 16.5, true);
          this.spawnObstacle('WIND_GUST', gateX + this.randRange(-14, 14), 0, z2, 4.4);
          this.spawnHazard(cx + (gateX > cx ? -24 : 24), z3, difficulty);
        } else {
          const gustX = cx + this.randRange(-16, 16);
          this.spawnObstacle('WIND_GUST', gustX, 0, z1, 4.5);
          this.spawnObstacle('RING', gustX, this.randRange(12, 22), z2 - 6, 4.3);

          const rampX = cx + (gustX > cx ? -22 : 22);
          this.spawnRampSet(rampX, z2, false, 12, false);
          this.spawnHazard(gustX, z3 - 5, difficulty);
        }

        if (difficulty > 2 && this.rand() < 0.65) {
          const extraX = cx + this.randRange(-CORRIDOR_HALF_WIDTH + 8, CORRIDOR_HALF_WIDTH - 8);
          this.spawnHazard(extraX, chunkStartZ - 84, difficulty);
        }
        break;
      }
    }

    this.chunkIndex++;
  }

  private ensureChunks(playerX: number, playerZ: number, mode: GameMode): void {
    const targetMinZ = playerZ - SPAWN_AHEAD_DISTANCE;
    while (this.nextChunkZ > targetMinZ) {
      this.generateChunk(this.nextChunkZ, playerX, mode);
      this.nextChunkZ -= CHUNK_LENGTH;
    }

    if (Math.abs(playerX - this.corridorCenterX) > 46) {
      this.generateChunk(playerZ - 28, playerX, mode);
    }
  }

  private recycleBehind(playerX: number, playerZ: number): void {
    const cutoffZ = playerZ + RECYCLE_BEHIND_DISTANCE;

    for (let i = this.activeObstacles.length - 1; i >= 0; i--) {
      const obs = this.activeObstacles[i];
      if (
        obs.item.position.z > cutoffZ ||
        Math.abs(obs.item.position.x - playerX) > RECYCLE_LATERAL_DISTANCE
      ) {
        obs.item.active = false;
        this.releaseObstacleMesh(obs.item.type, obs.mesh);
        this.activeObstacles.splice(i, 1);
      }
    }

    for (let i = this.activeCoins.length - 1; i >= 0; i--) {
      const coin = this.activeCoins[i];
      if (
        coin.collected ||
        coin.position.z > cutoffZ ||
        Math.abs(coin.position.x - playerX) > RECYCLE_LATERAL_DISTANCE
      ) {
        this.releaseCoinMesh(coin.mesh);
        this.activeCoins.splice(i, 1);
      }
    }

    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gate = this.gates[i];
      if (gate.z > cutoffZ || Math.abs(gate.centerX - playerX) > RECYCLE_LATERAL_DISTANCE) {
        this.gates.splice(i, 1);
      }
    }
  }

  private animateWorldObjects(dt: number, waveHeightFn: WaveHeightFn, time: number): void {
    for (let i = 0; i < this.activeObstacles.length; i++) {
      const obs = this.activeObstacles[i];
      const { item, mesh } = obs;

      if (item.type === 'RING') {
        const hoverY = obs.baseAltitude + Math.sin(time * 2.1 + obs.phase) * 0.45;
        item.position.set(obs.baseX, hoverY, item.position.z);
        mesh.position.copy(item.position);

        if (obs.flashTimer > 0) {
          obs.flashTimer = Math.max(0, obs.flashTimer - dt);
          const pulse = 1 + Math.sin((obs.flashTimer / 0.45) * Math.PI) * 0.35;
          mesh.scale.setScalar(pulse);
          mesh.rotation.z += dt * 7.5;
        } else {
          mesh.scale.setScalar(item.passed ? 0.72 : 1.0);
          mesh.rotation.z += dt * 0.9;
        }
        continue;
      }

      let x = obs.baseX;
      if (item.type === 'SHARK_FIN' && obs.patrolWidth > 0) {
        const patrolArg = time * obs.patrolSpeed + obs.phase;
        x = obs.baseX + Math.sin(patrolArg) * obs.patrolWidth;
        const velX = Math.cos(patrolArg);
        mesh.rotation.y = velX >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
      }

      const wave = waveHeightFn(x, item.position.z, time);
      const y = wave.height + obs.baseAltitude;
      item.position.set(x, y, item.position.z);
      mesh.position.copy(item.position);

      if (item.type === 'WIND_GUST') {
        mesh.rotation.y += dt * 3.4;
        for (let c = 0; c < mesh.children.length; c++) {
          const child = mesh.children[c];
          if (child.userData.swirlIndex !== undefined) {
            child.position.y += dt * 5.2;
            if (child.position.y > 16.5) child.position.y = 1.2;
          } else if (child.userData.streakIndex !== undefined) {
            child.position.y += dt * 8.0;
            if (child.position.y > 15.5) child.position.y = 1.5;
          }
        }
        continue;
      }

      // Bob gently with the ocean wave normal
      const tiltStrength = item.type === 'RAMP' ? 0.45 : 0.75;
      const targetRotZ = -wave.normal.x * tiltStrength;
      const targetRotX = wave.normal.z * tiltStrength;
      mesh.rotation.z += (targetRotZ - mesh.rotation.z) * Math.min(1, dt * 8);
      mesh.rotation.x += (targetRotX - mesh.rotation.x) * Math.min(1, dt * 8);

      if (item.type === 'BUOY_LEFT' || item.type === 'BUOY_RIGHT') {
        // Subtle buoy spin / flag flutter feel
        mesh.rotation.y = Math.sin(time * 2.5 + obs.phase) * 0.16;
      } else if (item.type === 'FLOATING_BARREL') {
        mesh.rotation.y = obs.phase + Math.sin(time * 1.1 + obs.phase) * 0.25;
      }
    }

    for (let i = 0; i < this.activeCoins.length; i++) {
      const coin = this.activeCoins[i];
      if (coin.collected) continue;

      const bob = Math.sin(time * 3.5 + coin.phase) * 0.28;
      if (coin.baseAltitude <= 2.2) {
        const wave = waveHeightFn(coin.position.x, coin.position.z, time);
        coin.position.y = wave.height + coin.baseAltitude + bob;
      } else {
        coin.position.y = coin.baseAltitude + bob;
      }

      coin.mesh.position.copy(coin.position);
      coin.mesh.rotation.y += dt * 3.2;
    }
  }

  /**
   * Resets all world obstacles and coins and seeds a fresh corridor for the chosen mode.
   */
  public reset(mode: GameMode, startX = 0, startZ = 0): void {
    this.currentMode = mode;

    for (const obs of this.activeObstacles) {
      obs.item.active = false;
      this.releaseObstacleMesh(obs.item.type, obs.mesh);
    }
    this.activeObstacles = [];

    for (const coin of this.activeCoins) {
      this.releaseCoinMesh(coin.mesh);
    }
    this.activeCoins = [];
    this.gates = [];

    this.nextObstacleId = 1;
    this.nextCoinId = 1;
    this.nextGateId = 1;
    this.chunkIndex = 0;
    this.slalomGateCounter = 0;
    this.corridorCenterX = startX;
    this.nextChunkZ = startZ - 35;
    this.prevPlayerX = null;
    this.prevPlayerY = null;
    this.prevPlayerZ = null;
    this.rngState = (Date.now() ^ 0x9e3779b9) >>> 0 || 1337;

    this.ensureChunks(startX, startZ, mode);
  }

  /**
   * Animates world items around a focal point (useful during MENU orbit/flyover).
   */
  public animatePreview(
    dt: number,
    centerPos: THREE.Vector3,
    waveHeightFn: WaveHeightFn,
    time: number
  ): void {
    this.ensureChunks(centerPos.x, centerPos.z, this.currentMode);
    this.recycleBehind(centerPos.x, centerPos.z);
    this.animateWorldObjects(dt, waveHeightFn, time);
  }

  /**
   * Updates procedural ocean corridor, animates objects on waves, and evaluates player collisions.
   */
  public update(
    dt: number,
    physicsState: PhysicsState,
    mode: GameMode,
    waveHeightFn: WaveHeightFn,
    time: number
  ): WorldEvent[] {
    if (mode !== this.currentMode) {
      this.reset(mode, physicsState.position.x, physicsState.position.z);
    }

    const px = physicsState.position.x;
    const py = physicsState.position.y;
    const pz = physicsState.position.z;
    const prevX = this.prevPlayerX ?? px;
    const prevY = this.prevPlayerY ?? py;
    const prevZ = this.prevPlayerZ ?? pz;

    this.ensureChunks(px, pz, mode);
    this.recycleBehind(px, pz);
    this.animateWorldObjects(dt, waveHeightFn, time);

    const events: WorldEvent[] = [];

    if (!physicsState.wipeout) {
      // 1. Coin pickups (3D swept proximity so both -Z and 80°-90° lateral tacks collect smoothly)
      const coinRadiusSq = 3.0 * 3.0;
      for (let i = 0; i < this.activeCoins.length; i++) {
        const coin = this.activeCoins[i];
        if (coin.collected) continue;

        const segDistSq = distToSegmentSq3D(
          coin.position.x,
          coin.position.y,
          coin.position.z,
          prevX,
          prevY + 0.8,
          prevZ,
          px,
          py + 0.8,
          pz
        );

        if (segDistSq <= coinRadiusSq) {
          coin.collected = true;
          coin.mesh.visible = false;
          events.push({
            type: 'COIN_PICKUP',
            position: coin.position.clone(),
            points: 100,
            coins: 1,
          });
        }
      }

      // 2. Slalom Gate Clears
      for (let i = 0; i < this.gates.length; i++) {
        const gate = this.gates[i];
        if (gate.cleared) continue;

        const crossedGate =
          (prevZ >= gate.z && pz <= gate.z) ||
          Math.abs(pz - gate.z) <= 1.4;

        if (crossedGate) {
          const minX = gate.left.item.position.x - 0.9;
          const maxX = gate.right.item.position.x + 0.9;
          const gateWaveY = Math.min(
            gate.left.item.position.y,
            gate.right.item.position.y
          );
          if (px >= minX && px <= maxX && py <= gateWaveY + 11.0) {
            gate.cleared = true;
            gate.left.item.passed = true;
            gate.right.item.passed = true;
            const pts = mode === 'SLALOM' ? 600 : 400;
            events.push({
              type: 'GATE_CLEAR',
              position: new THREE.Vector3(gate.centerX, py, gate.z),
              points: pts,
              coins: 2,
              impulse: new THREE.Vector3(0, 0, -4.5),
              label: `GATE CLEAR! +${pts}`,
            });
          }
        }
      }

      // 3. Obstacles (Ramps, Rings, Wind Gusts, Hazards)
      for (let i = 0; i < this.activeObstacles.length; i++) {
        const obs = this.activeObstacles[i];
        const { item } = obs;
        if (!item.active || item.passed) continue;

        const ox = item.position.x;
        const oy = item.position.y;
        const oz = item.position.z;
        const dx = px - ox;
        const dz = pz - oz;

        switch (item.type) {
          case 'RAMP': {
            const onRampY = py >= oy - 2.0 && py <= oy + 4.8;
            const lateralApproach = Math.abs(px - prevX) > Math.abs(pz - prevZ) * 0.85;
            const onRampFootprint =
              Math.abs(dx) <= 4.1 &&
              (lateralApproach
                ? Math.abs(dz) <= 5.4
                : (pz <= oz + 2.2 && pz >= oz - 5.4) ||
                  (prevZ >= oz - 4.5 && pz <= oz + 1.5));
            const nearRamp2D = distToSegmentSq2D(ox, oz, prevX, prevZ, px, pz) <= 4.6 * 4.6;
            if (onRampY && (onRampFootprint || nearRamp2D)) {
              item.passed = true;
              events.push({
                type: 'RAMP_BOOST',
                position: item.position.clone(),
                points: 350,
                coins: 2,
                impulse: new THREE.Vector3(0, 15.5, -8.5),
                label: 'KICKER BOOST! +350',
              });
            }
            break;
          }

          case 'RING': {
            const ringSegDistSq = distToSegmentSq3D(
              ox,
              oy,
              oz,
              prevX,
              prevY + 0.8,
              prevZ,
              px,
              py + 0.8,
              pz
            );
            const ringTriggerRadius = item.radius + 1.35;
            if (ringSegDistSq <= ringTriggerRadius * ringTriggerRadius) {
              item.passed = true;
              obs.flashTimer = 0.45;
              events.push({
                type: 'RING_PASS',
                position: item.position.clone(),
                points: 1200,
                coins: 5,
                impulse: new THREE.Vector3(0, 4.5, -4.5),
                label: 'SKY RING! +1,200',
              });
            }
            break;
          }

          case 'WIND_GUST': {
            const gustSegDistSq = distToSegmentSq2D(ox, oz, prevX, prevZ, px, pz);
            if (
              gustSegDistSq <= (item.radius + 0.8) ** 2 &&
              py >= oy - 1.5 &&
              py <= oy + 19.0
            ) {
              item.passed = true;
              events.push({
                type: 'GUST_LIFT',
                position: item.position.clone(),
                points: 250,
                coins: 1,
                impulse: new THREE.Vector3(0, 12.5, -4.5),
                label: 'THERMAL GUST! +250',
              });
            }
            break;
          }

          case 'FLOATING_BARREL':
          case 'SHARK_FIN': {
            const horizDist = Math.hypot(dx, dz);
            const maxHitHeight = item.type === 'SHARK_FIN' ? 1.45 : 1.35;
            if (
              horizDist <= item.radius + 0.7 &&
              py >= oy - 2.0 &&
              py <= oy + maxHitHeight
            ) {
              item.passed = true;
              events.push({
                type: 'HAZARD_HIT',
                position: item.position.clone(),
                points: 0,
                coins: 0,
                impulse: new THREE.Vector3(0, 3.0, 6.0),
                label: item.type === 'SHARK_FIN' ? 'SHARK STRIKE!' : 'BARREL HIT!',
              });
            }
            break;
          }

          case 'BUOY_LEFT':
          case 'BUOY_RIGHT':
            // Handled cleanly as paired slalom gates above
            break;
        }
      }
    }

    this.prevPlayerX = px;
    this.prevPlayerY = py;
    this.prevPlayerZ = pz;
    return events;
  }

  public getActiveObstacles(): ObstacleItem[] {
    return this.activeObstacles.map((o) => o.item);
  }

  public getActiveCoinCount(): number {
    let count = 0;
    for (let i = 0; i < this.activeCoins.length; i++) {
      if (!this.activeCoins[i].collected) count++;
    }
    return count;
  }

  public dispose(): void {
    this.scene.remove(this.worldGroup);
    for (const geo of this.assets.geometries) {
      geo.dispose();
    }
    for (const mat of this.assets.materials) {
      mat.dispose();
    }
    this.activeObstacles = [];
    this.activeCoins = [];
    this.gates = [];
  }
}
