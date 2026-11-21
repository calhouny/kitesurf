import * as THREE from 'three';
import type { PhysicsState, WaveHeightFn } from './types.ts';

export interface ParticleUpdateOptions {
  leftWingtip?: THREE.Vector3;
  rightWingtip?: THREE.Vector3;
  boardLeftPos?: THREE.Vector3;
  boardRightPos?: THREE.Vector3;
  boardTailPos?: THREE.Vector3;
  waveHeightFn?: WaveHeightFn;
  ribbonColor?: THREE.ColorRepresentation;
}

const MAX_SPRAY_PARTICLES = 1024;
const WAKE_CAPACITY = 110;
const WAKE_LIFETIME = 3.2;
const RIBBON_NODES = 54;
const RIBBON_LIFETIME = 1.05;
const MAX_SPLASH_RINGS = 8;
const KITE_LINE_LENGTH = 22.0;
const KITE_HALF_SPAN = 2.85;

const SPRAY_VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute float aTint;

varying float vAlpha;
varying float vTint;

void main() {
  vAlpha = aAlpha;
  vTint = aTint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (340.0 / max(1.0, -mvPosition.z)), 2.0, 74.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SPRAY_FRAGMENT_SHADER = /* glsl */ `
varying float vAlpha;
varying float vTint;

void main() {
  if (vAlpha <= 0.004) discard;
  vec2 uv = gl_PointCoord - vec2(0.5);
  float r = length(uv);
  if (r > 0.5) discard;

  float core = smoothstep(0.5, 0.08, r);
  float sparkle = smoothstep(0.28, 0.0, r);
  vec3 mistCol = vec3(0.84, 0.97, 1.0);
  vec3 foamCol = vec3(1.0, 0.995, 0.97);
  vec3 col = mix(mistCol, foamCol, clamp(vTint + sparkle * 0.5, 0.0, 1.0));
  float alpha = core * vAlpha;
  gl_FragColor = vec4(col, alpha);
}
`;

const WAKE_VERTEX_SHADER = /* glsl */ `
attribute float aAlpha;
attribute float aSide;
attribute float aDist;
attribute float aAgeNorm;

varying float vAlpha;
varying float vSide;
varying float vDist;
varying float vAgeNorm;

void main() {
  vAlpha = aAlpha;
  vSide = aSide;
  vDist = aDist;
  vAgeNorm = aAgeNorm;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const WAKE_FRAGMENT_SHADER = /* glsl */ `
varying float vAlpha;
varying float vSide;
varying float vDist;
varying float vAgeNorm;

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.12);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  if (vAlpha <= 0.005) discard;
  float edgeFade = smoothstep(1.0, 0.18, abs(vSide));
  vec2 uv = vec2(vDist * 0.65, vSide * 1.8);
  float n1 = noise2(uv * 2.2);
  float n2 = noise2(uv * 5.3 + vec2(4.2, 1.7));
  float foamTex = n1 * 0.65 + n2 * 0.35;

  // Dissolve foam into lacy bubbles as wake ages
  float dissolve = smoothstep(0.15 + vAgeNorm * 0.55, 0.72 + vAgeNorm * 0.25, foamTex + (1.0 - vAgeNorm) * 0.35);
  float alpha = edgeFade * dissolve * vAlpha;
  if (alpha <= 0.01) discard;

  vec3 foamColor = mix(vec3(0.76, 0.96, 0.99), vec3(0.99, 0.995, 1.0), foamTex);
  gl_FragColor = vec4(foamColor, alpha * 0.9);
}
`;

const RING_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT_SHADER = /* glsl */ `
uniform float uAlpha;
varying vec2 vUv;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float band = smoothstep(0.42, 0.68, r) * smoothstep(1.0, 0.72, r);
  float alpha = band * uAlpha;
  if (alpha <= 0.01) discard;
  gl_FragColor = vec4(0.94, 0.99, 1.0, alpha);
}
`;

const RIBBON_VERTEX_SHADER = /* glsl */ `
attribute vec3 aTangent;
attribute float aSideOffset;
attribute float aAcross;
attribute float aAlpha;
attribute float aBoost;

varying float vAcross;
varying float vAlpha;
varying float vBoost;

void main() {
  vAcross = aAcross;
  vAlpha = aAlpha;
  vBoost = aBoost;

  vec3 viewDir = normalize(cameraPosition - position);
  vec3 tang = normalize(aTangent + vec3(0.0, 0.0, 1e-5));
  vec3 side = cross(tang, viewDir);
  float sideLen = length(side);
  side = sideLen > 0.001 ? side / sideLen : vec3(1.0, 0.0, 0.0);

  vec3 worldPos = position + side * aSideOffset;
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const RIBBON_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uBaseColor;
varying float vAcross;
varying float vAlpha;
varying float vBoost;

void main() {
  if (vAlpha <= 0.005) discard;
  float radial = 1.0 - abs(vAcross);
  float glow = pow(clamp(radial, 0.0, 1.0), 2.1);
  float core = pow(clamp(radial, 0.0, 1.0), 5.0);

  vec3 boostCol = vec3(1.0, 0.78, 0.28);
  vec3 col = mix(uBaseColor, boostCol, clamp(vBoost, 0.0, 1.0));
  col = mix(col, vec3(1.0), core * 0.78);

  float alpha = glow * vAlpha;
  if (alpha <= 0.005) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

interface WakeNode {
  x: number;
  z: number;
  rightX: number;
  rightZ: number;
  dist: number;
  age: number;
  intensity: number;
  breakBefore: boolean;
}

interface RibbonNode {
  x: number;
  y: number;
  z: number;
  age: number;
  alpha: number;
  boost: number;
}

interface SplashRingState {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  active: boolean;
  age: number;
  maxAge: number;
  startScale: number;
  endScale: number;
  x: number;
  z: number;
}

interface RibbonHandle {
  nodes: RibbonNode[];
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  positions: Float32Array;
  tangents: Float32Array;
  sideOffsets: Float32Array;
  across: Float32Array;
  alphas: Float32Array;
  boosts: Float32Array;
}

export class ParticleSystem {
  private readonly scene: THREE.Scene;
  private waveHeightFn?: WaveHeightFn;

  // Spray / Splash Points Pool
  private readonly sprayGeo: THREE.BufferGeometry;
  private readonly sprayMat: THREE.ShaderMaterial;
  private readonly sprayPoints: THREE.Points;
  private readonly sprayPos: Float32Array;
  private readonly sprayVel: Float32Array;
  private readonly sprayAge: Float32Array;
  private readonly sprayMaxAge: Float32Array;
  private readonly spraySize: Float32Array;
  private readonly sprayAlpha: Float32Array;
  private readonly sprayBaseAlpha: Float32Array;
  private readonly sprayTint: Float32Array;
  private readonly sprayActive: Uint8Array;
  private sprayCursor = 0;
  private leftSprayAccum = 0;
  private rightSprayAccum = 0;

  // V-Shaped Wake Trail (3 ribbons: Left V-arm, Right V-arm, Center Churn)
  private readonly wakeNodes: WakeNode[] = [];
  private readonly wakeGeo: THREE.BufferGeometry;
  private readonly wakeMat: THREE.ShaderMaterial;
  private readonly wakeMesh: THREE.Mesh;
  private readonly wakePositions: Float32Array;
  private readonly wakeAlphas: Float32Array;
  private readonly wakeSides: Float32Array;
  private readonly wakeDists: Float32Array;
  private readonly wakeAgeNorms: Float32Array;
  private readonly wakeIndices: Uint16Array;
  private wakeTotalDist = 0;
  private wakeEmitTimer = 0;
  private lastWakeX = 0;
  private lastWakeZ = 0;
  private hasLastWakePos = false;
  private needsWakeBreak = true;

  // Expanding Splash Rings
  private readonly splashRings: SplashRingState[] = [];
  private readonly ringGeo: THREE.RingGeometry;

  // Kite Wingtip Wind-Trail Ribbons
  private readonly leftRibbon: RibbonHandle;
  private readonly rightRibbon: RibbonHandle;

  // Transition Tracking & Scratch Vectors
  private wasAirborne = false;
  private wasWipeout = false;
  private lastPopTime = -10;
  private lastLandTime = -10;
  private lastWipeoutTime = -10;
  private internalTime = 0;

  private readonly tmpLeftTip = new THREE.Vector3();
  private readonly tmpRightTip = new THREE.Vector3();
  private readonly tmpBaseColor = new THREE.Color(0x52f2ff);
  private readonly tmpNormal = new THREE.Vector3(0, 1, 0);
  private readonly upVec = new THREE.Vector3(0, 1, 0);
  private readonly tmpQuat = new THREE.Quaternion();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Unified Spray & Splash Points System
    this.sprayPos = new Float32Array(MAX_SPRAY_PARTICLES * 3);
    this.sprayVel = new Float32Array(MAX_SPRAY_PARTICLES * 3);
    this.sprayAge = new Float32Array(MAX_SPRAY_PARTICLES);
    this.sprayMaxAge = new Float32Array(MAX_SPRAY_PARTICLES);
    this.spraySize = new Float32Array(MAX_SPRAY_PARTICLES);
    this.sprayAlpha = new Float32Array(MAX_SPRAY_PARTICLES);
    this.sprayBaseAlpha = new Float32Array(MAX_SPRAY_PARTICLES);
    this.sprayTint = new Float32Array(MAX_SPRAY_PARTICLES);
    this.sprayActive = new Uint8Array(MAX_SPRAY_PARTICLES);

    this.sprayGeo = new THREE.BufferGeometry();
    this.sprayGeo.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    this.sprayGeo.setAttribute('aSize', new THREE.BufferAttribute(this.spraySize, 1));
    this.sprayGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.sprayAlpha, 1));
    this.sprayGeo.setAttribute('aTint', new THREE.BufferAttribute(this.sprayTint, 1));

    this.sprayMat = new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERTEX_SHADER,
      fragmentShader: SPRAY_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
    });

    this.sprayPoints = new THREE.Points(this.sprayGeo, this.sprayMat);
    this.sprayPoints.frustumCulled = false;
    this.sprayPoints.renderOrder = 6;
    this.scene.add(this.sprayPoints);

    // 2. Persistent V-Shaped Foam Wake Mesh (3 strips * WAKE_CAPACITY * 2 vertices)
    const totalWakeVerts = 3 * WAKE_CAPACITY * 2;
    const maxWakeIndices = 3 * (WAKE_CAPACITY - 1) * 6;
    this.wakePositions = new Float32Array(totalWakeVerts * 3);
    this.wakeAlphas = new Float32Array(totalWakeVerts);
    this.wakeSides = new Float32Array(totalWakeVerts);
    this.wakeDists = new Float32Array(totalWakeVerts);
    this.wakeAgeNorms = new Float32Array(totalWakeVerts);
    this.wakeIndices = new Uint16Array(maxWakeIndices);

    this.wakeGeo = new THREE.BufferGeometry();
    this.wakeGeo.setAttribute('position', new THREE.BufferAttribute(this.wakePositions, 3));
    this.wakeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.wakeAlphas, 1));
    this.wakeGeo.setAttribute('aSide', new THREE.BufferAttribute(this.wakeSides, 1));
    this.wakeGeo.setAttribute('aDist', new THREE.BufferAttribute(this.wakeDists, 1));
    this.wakeGeo.setAttribute('aAgeNorm', new THREE.BufferAttribute(this.wakeAgeNorms, 1));
    this.wakeGeo.setIndex(new THREE.BufferAttribute(this.wakeIndices, 1));
    this.wakeGeo.setDrawRange(0, 0);

    this.wakeMat = new THREE.ShaderMaterial({
      vertexShader: WAKE_VERTEX_SHADER,
      fragmentShader: WAKE_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.wakeMesh = new THREE.Mesh(this.wakeGeo, this.wakeMat);
    this.wakeMesh.frustumCulled = false;
    this.wakeMesh.renderOrder = 2;
    this.scene.add(this.wakeMesh);

    // 3. Expanding Splash Rings
    this.ringGeo = new THREE.RingGeometry(0.45, 1.0, 28);
    this.ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_SPLASH_RINGS; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uAlpha: { value: 0 } },
        vertexShader: RING_VERTEX_SHADER,
        fragmentShader: RING_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.splashRings.push({
        mesh,
        material: mat,
        active: false,
        age: 0,
        maxAge: 1,
        startScale: 1,
        endScale: 6,
        x: 0,
        z: 0,
      });
    }

    // 4. Kite Wingtip Wind-Trail Ribbons
    this.leftRibbon = this.createRibbon();
    this.rightRibbon = this.createRibbon();
    this.scene.add(this.leftRibbon.mesh, this.rightRibbon.mesh);
  }

  public setWaveHeightFn(fn: WaveHeightFn): void {
    this.waveHeightFn = fn;
  }

  public update(
    dt: number,
    physics: PhysicsState,
    time: number,
    options?: ParticleUpdateOptions
  ): void {
    const clampedDt = Math.min(Math.max(dt, 0), 0.05);
    this.internalTime = time;

    if (options?.waveHeightFn) {
      this.waveHeightFn = options.waveHeightFn;
    }

    if (options?.ribbonColor !== undefined) {
      this.tmpBaseColor.set(options.ribbonColor);
      this.leftRibbon.material.uniforms.uBaseColor.value.copy(this.tmpBaseColor);
      this.rightRibbon.material.uniforms.uBaseColor.value.copy(this.tmpBaseColor);
    }

    // Auto-detect physics state transitions so splash bursts trigger seamlessly
    if (!this.wasAirborne && physics.isAirborne && physics.velocity.y > 4.0) {
      if (time - this.lastPopTime > 0.18) {
        this.emitJumpPop(
          physics.position,
          THREE.MathUtils.clamp(physics.velocity.y / 14, 0.7, 1.8)
        );
      }
    }
    if (this.wasAirborne && !physics.isAirborne) {
      if (time - this.lastLandTime > 0.18) {
        const impactSpeed = Math.abs(physics.velocity.y);
        this.emitLandingSplash(physics.position, impactSpeed, !physics.wipeout);
      }
    }
    if (!this.wasWipeout && physics.wipeout) {
      if (time - this.lastWipeoutTime > 0.25) {
        this.emitWipeoutSplash(physics.position);
      }
    }
    this.wasAirborne = physics.isAirborne;
    this.wasWipeout = physics.wipeout;

    // 1. Update board rail water spray
    this.updateRailSpray(clampedDt, physics, options);

    // 2. Update spray/splash particles
    this.updateSprayParticles(clampedDt, physics);

    // 3. Update V-shaped wake trail
    this.updateWakeTrail(clampedDt, physics, time, options);

    // 4. Update expanding splash rings
    this.updateSplashRings(clampedDt, physics, time);

    // 5. Update wingtip ribbons
    this.updateWingtipRibbons(clampedDt, physics, options);
  }

  public emitJumpPop(position: THREE.Vector3, intensity = 1.0): void {
    this.lastPopTime = this.internalTime;
    const count = Math.round(58 * THREE.MathUtils.clamp(intensity, 0.5, 2.0));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = (2.0 + Math.random() * 5.2) * intensity;
      const upSpeed = (4.5 + Math.random() * 6.5) * intensity;
      this.spawnSprayParticle(
        position.x + Math.cos(angle) * 0.45,
        position.y + 0.12 + Math.random() * 0.25,
        position.z + Math.sin(angle) * 0.45,
        Math.cos(angle) * radialSpeed,
        upSpeed,
        Math.sin(angle) * radialSpeed,
        0.45 + Math.random() * 0.4,
        1.1 + Math.random() * 1.4,
        0.75 + Math.random() * 0.25,
        0.45 + Math.random() * 0.55
      );
    }
    this.spawnSplashRing(position.x, position.z, 0.8, 5.2 * intensity, 0.75);
  }

  public emitLandingSplash(
    position: THREE.Vector3,
    impactSpeed = 10,
    clean = true
  ): void {
    this.lastLandTime = this.internalTime;
    const intensity = THREE.MathUtils.clamp(impactSpeed / 10, 0.7, 2.2);
    const count = Math.round((clean ? 85 : 130) * intensity);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = (3.2 + Math.random() * 7.5) * intensity;
      const upSpeed = (3.5 + Math.random() * 6.8) * intensity;
      this.spawnSprayParticle(
        position.x + Math.cos(angle) * (0.3 + Math.random() * 0.6),
        position.y + 0.1 + Math.random() * 0.2,
        position.z + Math.sin(angle) * (0.3 + Math.random() * 0.6),
        Math.cos(angle) * radialSpeed,
        upSpeed,
        Math.sin(angle) * radialSpeed,
        0.5 + Math.random() * 0.5,
        1.2 + Math.random() * 1.7,
        0.8 + Math.random() * 0.2,
        Math.random()
      );
    }

    this.spawnSplashRing(position.x, position.z, 1.0, 6.8 * intensity, 0.9);
    if (!clean || intensity > 1.15) {
      this.spawnSplashRing(position.x, position.z, 0.6, 9.2 * intensity, 1.15);
    }
  }

  public emitWipeoutSplash(position: THREE.Vector3): void {
    this.lastWipeoutTime = this.internalTime;
    this.emitSplashBurst(position, 165, true);
  }

  public emitSplashBurst(
    position: THREE.Vector3,
    count = 110,
    isWipeout = false
  ): void {
    const mult = isWipeout ? 1.5 : 1.0;
    const clampedCount = Math.min(260, Math.max(20, Math.round(count)));
    for (let i = 0; i < clampedCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radial = (2.5 + Math.random() * 8.5) * mult;
      const up = (4.0 + Math.random() * 9.5) * mult;
      this.spawnSprayParticle(
        position.x + Math.cos(angle) * (0.2 + Math.random() * 0.9),
        position.y + 0.15 + Math.random() * 0.35,
        position.z + Math.sin(angle) * (0.2 + Math.random() * 0.9),
        Math.cos(angle) * radial,
        up,
        Math.sin(angle) * radial,
        0.55 + Math.random() * 0.65,
        1.4 + Math.random() * 2.2,
        0.82 + Math.random() * 0.18,
        Math.random()
      );
    }
    this.spawnSplashRing(position.x, position.z, 1.1, 8.5 * mult, 1.05);
    this.spawnSplashRing(position.x, position.z, 0.6, 11.5 * mult, 1.35);
  }

  public reset(): void {
    this.sprayActive.fill(0);
    this.sprayAlpha.fill(0);
    (this.sprayGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    this.leftSprayAccum = 0;
    this.rightSprayAccum = 0;

    this.wakeNodes.length = 0;
    this.wakeTotalDist = 0;
    this.wakeEmitTimer = 0;
    this.hasLastWakePos = false;
    this.needsWakeBreak = true;
    this.wakeGeo.setDrawRange(0, 0);

    for (const ring of this.splashRings) {
      ring.active = false;
      ring.mesh.visible = false;
    }

    this.leftRibbon.nodes.length = 0;
    this.rightRibbon.nodes.length = 0;
    this.leftRibbon.geometry.setDrawRange(0, 0);
    this.rightRibbon.geometry.setDrawRange(0, 0);

    this.wasAirborne = false;
    this.wasWipeout = false;
  }

  public dispose(): void {
    this.scene.remove(
      this.sprayPoints,
      this.wakeMesh,
      this.leftRibbon.mesh,
      this.rightRibbon.mesh
    );
    this.sprayGeo.dispose();
    this.sprayMat.dispose();
    this.wakeGeo.dispose();
    this.wakeMat.dispose();
    this.ringGeo.dispose();
    for (const ring of this.splashRings) {
      this.scene.remove(ring.mesh);
      ring.material.dispose();
    }
    this.leftRibbon.geometry.dispose();
    this.leftRibbon.material.dispose();
    this.rightRibbon.geometry.dispose();
    this.rightRibbon.material.dispose();
  }

  private spawnSprayParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    maxAge: number,
    size: number,
    alpha: number,
    tint: number
  ): void {
    const idx = this.sprayCursor;
    this.sprayCursor = (this.sprayCursor + 1) % MAX_SPRAY_PARTICLES;

    this.sprayActive[idx] = 1;
    this.sprayPos[idx * 3] = x;
    this.sprayPos[idx * 3 + 1] = y;
    this.sprayPos[idx * 3 + 2] = z;

    this.sprayVel[idx * 3] = vx;
    this.sprayVel[idx * 3 + 1] = vy;
    this.sprayVel[idx * 3 + 2] = vz;

    this.sprayAge[idx] = 0;
    this.sprayMaxAge[idx] = maxAge;
    this.spraySize[idx] = size;
    this.sprayBaseAlpha[idx] = alpha;
    this.sprayAlpha[idx] = alpha;
    this.sprayTint[idx] = tint;
  }

  private updateRailSpray(
    dt: number,
    physics: PhysicsState,
    options?: ParticleUpdateOptions
  ): void {
    if (physics.isAirborne || physics.wipeout) {
      this.leftSprayAccum = 0;
      this.rightSprayAccum = 0;
      return;
    }

    const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
    if (speed < 2.5) return;

    const fwdX = Math.sin(physics.boardYaw);
    const fwdZ = -Math.cos(physics.boardYaw);
    const rightX = Math.cos(physics.boardYaw);
    const rightZ = Math.sin(physics.boardYaw);

    const speedNorm = THREE.MathUtils.clamp(speed / 22, 0.15, 1.8);
    const tensionBoost = 0.45 + 0.75 * THREE.MathUtils.clamp(physics.lineTension, 0, 1.2);
    const carveBias = THREE.MathUtils.clamp(physics.boardRoll / 0.55, -1, 1);

    const leftFactor =
      speedNorm * tensionBoost * (carveBias < 0 ? 1.0 - carveBias * 1.25 : 0.45);
    const rightFactor =
      speedNorm * tensionBoost * (carveBias > 0 ? 1.0 + carveBias * 1.25 : 0.45);

    const spawnRate = 115;
    this.leftSprayAccum = Math.min(20, this.leftSprayAccum + leftFactor * spawnRate * dt);
    this.rightSprayAccum = Math.min(20, this.rightSprayAccum + rightFactor * spawnRate * dt);

    const baseWaterY = physics.waterHeightAtPlayer + 0.08;
    const leftAnchor = options?.boardLeftPos;
    const rightAnchor = options?.boardRightPos;

    while (this.leftSprayAccum >= 1) {
      this.leftSprayAccum -= 1;
      const tailOffset = -0.15 - Math.random() * 0.55;
      const sideOffset = -0.26 - Math.random() * 0.08;
      const outSpeed = (1.6 + Math.random() * 3.8) * (0.6 + leftFactor * 0.65);
      const upSpeed = (1.8 + Math.random() * 3.8) * (0.55 + leftFactor * 0.55);

      const px = leftAnchor
        ? leftAnchor.x + (Math.random() - 0.5) * 0.18
        : physics.position.x + fwdX * tailOffset + rightX * sideOffset;
      const py = leftAnchor
        ? Math.max(baseWaterY, leftAnchor.y) + Math.random() * 0.12
        : baseWaterY + Math.random() * 0.12;
      const pz = leftAnchor
        ? leftAnchor.z + (Math.random() - 0.5) * 0.18
        : physics.position.z + fwdZ * tailOffset + rightZ * sideOffset;

      this.spawnSprayParticle(
        px,
        py,
        pz,
        -rightX * outSpeed + physics.velocity.x * 0.35 - fwdX * (1.2 + Math.random() * 1.8),
        upSpeed,
        -rightZ * outSpeed + physics.velocity.z * 0.35 - fwdZ * (1.2 + Math.random() * 1.8),
        0.32 + Math.random() * 0.36,
        0.75 + Math.random() * 1.1 * Math.min(1.4, leftFactor),
        0.58 + Math.random() * 0.32,
        Math.random()
      );
    }

    while (this.rightSprayAccum >= 1) {
      this.rightSprayAccum -= 1;
      const tailOffset = -0.15 - Math.random() * 0.55;
      const sideOffset = 0.26 + Math.random() * 0.08;
      const outSpeed = (1.6 + Math.random() * 3.8) * (0.6 + rightFactor * 0.65);
      const upSpeed = (1.8 + Math.random() * 3.8) * (0.55 + rightFactor * 0.55);

      const px = rightAnchor
        ? rightAnchor.x + (Math.random() - 0.5) * 0.18
        : physics.position.x + fwdX * tailOffset + rightX * sideOffset;
      const py = rightAnchor
        ? Math.max(baseWaterY, rightAnchor.y) + Math.random() * 0.12
        : baseWaterY + Math.random() * 0.12;
      const pz = rightAnchor
        ? rightAnchor.z + (Math.random() - 0.5) * 0.18
        : physics.position.z + fwdZ * tailOffset + rightZ * sideOffset;

      this.spawnSprayParticle(
        px,
        py,
        pz,
        rightX * outSpeed + physics.velocity.x * 0.35 - fwdX * (1.2 + Math.random() * 1.8),
        upSpeed,
        rightZ * outSpeed + physics.velocity.z * 0.35 - fwdZ * (1.2 + Math.random() * 1.8),
        0.32 + Math.random() * 0.36,
        0.75 + Math.random() * 1.1 * Math.min(1.4, rightFactor),
        0.58 + Math.random() * 0.32,
        Math.random()
      );
    }
  }

  private updateSprayParticles(dt: number, physics: PhysicsState): void {
    const windX = Math.sin(physics.windDir) * physics.windSpeed * 0.16;
    const windZ = -Math.cos(physics.windDir) * physics.windSpeed * 0.16;
    const drag = Math.exp(-1.5 * dt);
    const killFloor = physics.waterHeightAtPlayer - 1.8;

    for (let i = 0; i < MAX_SPRAY_PARTICLES; i++) {
      if (this.sprayActive[i] === 0) continue;

      const age = this.sprayAge[i] + dt;
      const maxAge = this.sprayMaxAge[i];
      if (age >= maxAge) {
        this.sprayActive[i] = 0;
        this.sprayAlpha[i] = 0;
        continue;
      }

      this.sprayAge[i] = age;

      const i3 = i * 3;
      this.sprayVel[i3] = this.sprayVel[i3] * drag + windX * dt;
      this.sprayVel[i3 + 1] -= 14.5 * dt;
      this.sprayVel[i3 + 2] = this.sprayVel[i3 + 2] * drag + windZ * dt;

      this.sprayPos[i3] += this.sprayVel[i3] * dt;
      this.sprayPos[i3 + 1] += this.sprayVel[i3 + 1] * dt;
      this.sprayPos[i3 + 2] += this.sprayVel[i3 + 2] * dt;

      if (this.sprayPos[i3 + 1] < killFloor && this.sprayVel[i3 + 1] < 0) {
        this.sprayActive[i] = 0;
        this.sprayAlpha[i] = 0;
        continue;
      }

      const lifeT = age / maxAge;
      const fadeIn = Math.min(1, lifeT / 0.08);
      const fadeOut = Math.pow(Math.max(0, 1 - lifeT), 1.35);
      this.sprayAlpha[i] = this.sprayBaseAlpha[i] * fadeIn * fadeOut;
    }

    (this.sprayGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sprayGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.sprayGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.sprayGeo.attributes.aTint as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateWakeTrail(
    dt: number,
    physics: PhysicsState,
    time: number,
    options?: ParticleUpdateOptions
  ): void {
    // Age existing wake nodes and prune expired ones
    for (let i = 0; i < this.wakeNodes.length; i++) {
      this.wakeNodes[i].age += dt;
    }
    while (this.wakeNodes.length > 0 && this.wakeNodes[0].age >= WAKE_LIFETIME) {
      this.wakeNodes.shift();
    }

    // Emit new wake node when riding on water
    if (physics.isAirborne || physics.wipeout) {
      this.needsWakeBreak = true;
      this.hasLastWakePos = false;
    } else {
      const speed = Math.hypot(physics.velocity.x, physics.velocity.z);
      if (speed > 2.2) {
        const tailX = options?.boardTailPos
          ? options.boardTailPos.x
          : physics.position.x - (physics.velocity.x / speed) * 0.45;
        const tailZ = options?.boardTailPos
          ? options.boardTailPos.z
          : physics.position.z - (physics.velocity.z / speed) * 0.45;

        this.wakeEmitTimer += dt;
        const distMoved = this.hasLastWakePos
          ? Math.hypot(tailX - this.lastWakeX, tailZ - this.lastWakeZ)
          : 999;

        if (distMoved >= 0.55 || this.wakeEmitTimer >= 0.045) {
          this.wakeEmitTimer = 0;
          if (this.hasLastWakePos) {
            this.wakeTotalDist += distMoved;
          }
          this.lastWakeX = tailX;
          this.lastWakeZ = tailZ;
          this.hasLastWakePos = true;

          const dirX = physics.velocity.x / speed;
          const dirZ = physics.velocity.z / speed;
          // Perpendicular right vector in XZ plane
          const rightX = -dirZ;
          const rightZ = dirX;

          const intensity = THREE.MathUtils.clamp(
            (speed / 16) * (0.65 + 0.45 * physics.lineTension),
            0.35,
            1.15
          );

          if (this.wakeNodes.length >= WAKE_CAPACITY) {
            this.wakeNodes.shift();
          }

          this.wakeNodes.push({
            x: tailX,
            z: tailZ,
            rightX,
            rightZ,
            dist: this.wakeTotalDist,
            age: 0,
            intensity,
            breakBefore: this.needsWakeBreak,
          });
          this.needsWakeBreak = false;
        }
      } else {
        this.needsWakeBreak = true;
        this.hasLastWakePos = false;
      }
    }

    const nodeCount = this.wakeNodes.length;
    if (nodeCount < 2) {
      this.wakeGeo.setDrawRange(0, 0);
      return;
    }

    // Populate 3 foam strips: 0 = Left V-arm, 1 = Right V-arm, 2 = Center wake
    let indexCount = 0;
    const stridePerStrip = WAKE_CAPACITY * 2;

    for (let i = 0; i < nodeCount; i++) {
      const n = this.wakeNodes[i];
      const ageNorm = THREE.MathUtils.clamp(n.age / WAKE_LIFETIME, 0, 1);
      const fade = Math.pow(1 - ageNorm, 1.45) * n.intensity;
      const vSpread = 0.24 + n.age * 2.1;

      for (let strip = 0; strip < 3; strip++) {
        let centerOffset = 0;
        let halfWidth = 0.24 + n.age * 0.34;
        let stripAlpha = fade;

        if (strip === 0) {
          centerOffset = -vSpread;
          halfWidth = 0.20 + n.age * 0.50;
        } else if (strip === 1) {
          centerOffset = vSpread;
          halfWidth = 0.20 + n.age * 0.50;
        } else {
          stripAlpha = fade * Math.pow(1 - ageNorm, 0.7) * 0.75;
        }

        const cx = n.x + n.rightX * centerOffset;
        const cz = n.z + n.rightZ * centerOffset;

        const lx = cx - n.rightX * halfWidth;
        const lz = cz - n.rightZ * halfWidth;
        const rx = cx + n.rightX * halfWidth;
        const rz = cz + n.rightZ * halfWidth;

        const ly =
          (this.waveHeightFn
            ? this.waveHeightFn(lx, lz, time).height
            : physics.waterHeightAtPlayer) + 0.065;
        const ry =
          (this.waveHeightFn
            ? this.waveHeightFn(rx, rz, time).height
            : physics.waterHeightAtPlayer) + 0.065;

        const v0 = strip * stridePerStrip + i * 2;
        const v1 = v0 + 1;

        this.wakePositions[v0 * 3] = lx;
        this.wakePositions[v0 * 3 + 1] = ly;
        this.wakePositions[v0 * 3 + 2] = lz;
        this.wakePositions[v1 * 3] = rx;
        this.wakePositions[v1 * 3 + 1] = ry;
        this.wakePositions[v1 * 3 + 2] = rz;

        this.wakeAlphas[v0] = stripAlpha;
        this.wakeAlphas[v1] = stripAlpha;
        this.wakeSides[v0] = -1;
        this.wakeSides[v1] = 1;
        this.wakeDists[v0] = n.dist;
        this.wakeDists[v1] = n.dist;
        this.wakeAgeNorms[v0] = ageNorm;
        this.wakeAgeNorms[v1] = ageNorm;

        // Emit quad connecting node i-1 to i if contiguous
        if (i > 0 && !n.breakBefore) {
          const prev0 = strip * stridePerStrip + (i - 1) * 2;
          const prev1 = prev0 + 1;
          this.wakeIndices[indexCount++] = prev0;
          this.wakeIndices[indexCount++] = prev1;
          this.wakeIndices[indexCount++] = v0;
          this.wakeIndices[indexCount++] = v0;
          this.wakeIndices[indexCount++] = prev1;
          this.wakeIndices[indexCount++] = v1;
        }
      }
    }

    (this.wakeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.wakeGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.wakeGeo.attributes.aSide as THREE.BufferAttribute).needsUpdate = true;
    (this.wakeGeo.attributes.aDist as THREE.BufferAttribute).needsUpdate = true;
    (this.wakeGeo.attributes.aAgeNorm as THREE.BufferAttribute).needsUpdate = true;
    if (this.wakeGeo.index) {
      this.wakeGeo.index.needsUpdate = true;
    }
    this.wakeGeo.setDrawRange(0, indexCount);
  }

  private spawnSplashRing(
    x: number,
    z: number,
    startScale: number,
    endScale: number,
    maxAge: number
  ): void {
    let slot = this.splashRings.find((r) => !r.active);
    if (!slot) {
      // Recycle oldest ring if all slots are active
      slot = this.splashRings[0];
      for (let i = 1; i < this.splashRings.length; i++) {
        if (this.splashRings[i].age > slot.age) {
          slot = this.splashRings[i];
        }
      }
    }
    slot.active = true;
    slot.age = 0;
    slot.maxAge = maxAge;
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.x = x;
    slot.z = z;
    slot.mesh.visible = true;
  }

  private updateSplashRings(dt: number, physics: PhysicsState, time: number): void {
    for (const ring of this.splashRings) {
      if (!ring.active) continue;
      ring.age += dt;
      if (ring.age >= ring.maxAge) {
        ring.active = false;
        ring.mesh.visible = false;
        continue;
      }

      const t = ring.age / ring.maxAge;
      const easeOut = 1 - Math.pow(1 - t, 2.2);
      const scale = THREE.MathUtils.lerp(ring.startScale, ring.endScale, easeOut);

      let y = physics.waterHeightAtPlayer + 0.07;
      this.tmpNormal.copy(physics.waterNormalAtPlayer);
      if (this.waveHeightFn) {
        const sample = this.waveHeightFn(ring.x, ring.z, time);
        y = sample.height + 0.07;
        this.tmpNormal.copy(sample.normal);
      }

      ring.mesh.position.set(ring.x, y, ring.z);
      ring.mesh.scale.set(scale, 1, scale);
      this.tmpQuat.setFromUnitVectors(this.upVec, this.tmpNormal);
      ring.mesh.quaternion.copy(this.tmpQuat);
      ring.material.uniforms.uAlpha.value = Math.pow(1 - t, 1.5) * 0.72;
    }
  }

  private createRibbon(): RibbonHandle {
    const vertCount = RIBBON_NODES * 2;
    const positions = new Float32Array(vertCount * 3);
    const tangents = new Float32Array(vertCount * 3);
    const sideOffsets = new Float32Array(vertCount);
    const across = new Float32Array(vertCount);
    const alphas = new Float32Array(vertCount);
    const boosts = new Float32Array(vertCount);

    const indices: number[] = [];
    for (let i = 0; i < RIBBON_NODES - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangents, 3));
    geometry.setAttribute('aSideOffset', new THREE.BufferAttribute(sideOffsets, 1));
    geometry.setAttribute('aAcross', new THREE.BufferAttribute(across, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute('aBoost', new THREE.BufferAttribute(boosts, 1));
    geometry.setIndex(indices);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uBaseColor: { value: this.tmpBaseColor.clone() },
      },
      vertexShader: RIBBON_VERTEX_SHADER,
      fragmentShader: RIBBON_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;

    return {
      nodes: [],
      mesh,
      geometry,
      material,
      positions,
      tangents,
      sideOffsets,
      across,
      alphas,
      boosts,
    };
  }

  private updateWingtipRibbons(
    dt: number,
    physics: PhysicsState,
    options?: ParticleUpdateOptions
  ): void {
    let leftTip = options?.leftWingtip;
    let rightTip = options?.rightWingtip;

    if (!leftTip || !rightTip) {
      this.computeFallbackWingtips(physics, this.tmpLeftTip, this.tmpRightTip);
      leftTip = this.tmpLeftTip;
      rightTip = this.tmpRightTip;
    }

    // Activate ribbon brightness during high-speed dives, boosts, jumps, and kiteloops
    const diveActivity = THREE.MathUtils.clamp(
      (Math.abs(physics.kiteAngularVel) - 0.8) / 2.2,
      0,
      1
    );
    const speedActivity = THREE.MathUtils.clamp(
      (physics.apparentWind - 16.5) / 10,
      0,
      1
    );
    const tensionActivity = THREE.MathUtils.clamp(
      (physics.lineTension - 0.65) / 0.35,
      0,
      1
    );
    const airActivity = physics.isAirborne
      ? THREE.MathUtils.clamp(0.45 + physics.currentJumpHeight / 14, 0.45, 1)
      : 0;
    const loopActivity = physics.inKiteloop ? 1.0 : 0.0;

    const emitAlpha = Math.max(
      loopActivity,
      airActivity,
      diveActivity * 0.9,
      speedActivity * 0.75,
      tensionActivity * 0.65
    );
    const boostShift = Math.max(
      loopActivity,
      physics.isAirborne && physics.currentJumpHeight > 12 ? 0.65 : 0
    );

    this.advanceRibbon(this.leftRibbon, dt, leftTip, emitAlpha, boostShift);
    this.advanceRibbon(this.rightRibbon, dt, rightTip, emitAlpha, boostShift);
  }

  private advanceRibbon(
    ribbon: RibbonHandle,
    dt: number,
    tipPos: THREE.Vector3,
    emitAlpha: number,
    boostShift: number
  ): void {
    for (let i = 0; i < ribbon.nodes.length; i++) {
      ribbon.nodes[i].age += dt;
    }

    // Remove expired tail nodes, keeping at least 2 while active
    while (
      ribbon.nodes.length > 0 &&
      ribbon.nodes[ribbon.nodes.length - 1].age >= RIBBON_LIFETIME
    ) {
      ribbon.nodes.pop();
    }

    // Push newest sample at front if distance threshold met or list empty
    const head = ribbon.nodes[0];
    const distFromHead = head
      ? Math.hypot(tipPos.x - head.x, tipPos.y - head.y, tipPos.z - head.z)
      : 999;

    if (!head || distFromHead >= 0.35 || ribbon.nodes[0].age >= 0.025) {
      ribbon.nodes.unshift({
        x: tipPos.x,
        y: tipPos.y,
        z: tipPos.z,
        age: 0,
        alpha: emitAlpha,
        boost: boostShift,
      });
      if (ribbon.nodes.length > RIBBON_NODES) {
        ribbon.nodes.pop();
      }
    } else {
      // Smoothly track the live tip at head
      head.x = tipPos.x;
      head.y = tipPos.y;
      head.z = tipPos.z;
      head.alpha = Math.max(head.alpha, emitAlpha);
      head.boost = Math.max(head.boost, boostShift);
    }

    const count = ribbon.nodes.length;
    if (count < 2) {
      ribbon.geometry.setDrawRange(0, 0);
      return;
    }

    for (let i = 0; i < count; i++) {
      const curr = ribbon.nodes[i];
      const prev = ribbon.nodes[Math.max(0, i - 1)];
      const next = ribbon.nodes[Math.min(count - 1, i + 1)];

      let tx = prev.x - next.x;
      let ty = prev.y - next.y;
      let tz = prev.z - next.z;
      const tLen = Math.hypot(tx, ty, tz) || 1;
      tx /= tLen;
      ty /= tLen;
      tz /= tLen;

      const ageNorm = THREE.MathUtils.clamp(curr.age / RIBBON_LIFETIME, 0, 1);
      const tailNorm = i / Math.max(1, count - 1);
      const fade = Math.pow(1 - ageNorm, 1.35) * Math.pow(1 - tailNorm, 0.85);
      const alpha = curr.alpha * fade * 0.88;
      const halfWidth =
        (0.16 + curr.boost * 0.12) * (1 - tailNorm * 0.85) * Math.max(0.2, curr.alpha);

      const v0 = i * 2;
      const v1 = v0 + 1;

      ribbon.positions[v0 * 3] = curr.x;
      ribbon.positions[v0 * 3 + 1] = curr.y;
      ribbon.positions[v0 * 3 + 2] = curr.z;
      ribbon.positions[v1 * 3] = curr.x;
      ribbon.positions[v1 * 3 + 1] = curr.y;
      ribbon.positions[v1 * 3 + 2] = curr.z;

      ribbon.tangents[v0 * 3] = tx;
      ribbon.tangents[v0 * 3 + 1] = ty;
      ribbon.tangents[v0 * 3 + 2] = tz;
      ribbon.tangents[v1 * 3] = tx;
      ribbon.tangents[v1 * 3 + 1] = ty;
      ribbon.tangents[v1 * 3 + 2] = tz;

      ribbon.sideOffsets[v0] = -halfWidth;
      ribbon.sideOffsets[v1] = halfWidth;
      ribbon.across[v0] = -1;
      ribbon.across[v1] = 1;
      ribbon.alphas[v0] = alpha;
      ribbon.alphas[v1] = alpha;
      ribbon.boosts[v0] = curr.boost;
      ribbon.boosts[v1] = curr.boost;
    }

    (ribbon.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geometry.attributes.aTangent as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geometry.attributes.aSideOffset as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geometry.attributes.aAcross as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geometry.attributes.aBoost as THREE.BufferAttribute).needsUpdate = true;
    ribbon.geometry.setDrawRange(0, (count - 1) * 6);
  }

  private computeFallbackWingtips(
    physics: PhysicsState,
    outLeft: THREE.Vector3,
    outRight: THREE.Vector3
  ): void {
    const az = THREE.MathUtils.degToRad(physics.kiteAzimuth) + physics.windDir;
    const el = THREE.MathUtils.degToRad(physics.kiteElevation);

    const cosEl = Math.cos(el);
    const dirX = cosEl * Math.sin(az);
    const dirY = Math.sin(el);
    const dirZ = -cosEl * Math.cos(az);

    const anchorX = physics.position.x;
    const anchorY = physics.position.y + 1.15;
    const anchorZ = physics.position.z;

    const kiteX = anchorX + dirX * KITE_LINE_LENGTH;
    const kiteY = anchorY + dirY * KITE_LINE_LENGTH;
    const kiteZ = anchorZ + dirZ * KITE_LINE_LENGTH;

    // localRight = normalize(dir x up)
    let rx = -dirZ;
    let ry = 0;
    let rz = dirX;
    const rLen = Math.hypot(rx, rz);
    if (rLen > 0.001) {
      rx /= rLen;
      rz /= rLen;
    } else {
      rx = Math.cos(physics.windDir);
      rz = Math.sin(physics.windDir);
    }

    // localUp = localRight x dir
    const ux = ry * dirZ - rz * dirY;
    const uy = rz * dirX - rx * dirZ;
    const uz = rx * dirY - ry * dirX;

    const roll = physics.inKiteloop
      ? physics.kiteRoll + physics.kiteloopProgress * Math.PI * 2
      : physics.kiteRoll;
    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);

    const wingDirX = rx * cosR + ux * sinR;
    const wingDirY = ry * cosR + uy * sinR;
    const wingDirZ = rz * cosR + uz * sinR;

    const pullBack = 0.75;
    outLeft.set(
      kiteX - wingDirX * KITE_HALF_SPAN - dirX * pullBack,
      kiteY - wingDirY * KITE_HALF_SPAN - dirY * pullBack,
      kiteZ - wingDirZ * KITE_HALF_SPAN - dirZ * pullBack
    );
    outRight.set(
      kiteX + wingDirX * KITE_HALF_SPAN - dirX * pullBack,
      kiteY + wingDirY * KITE_HALF_SPAN - dirY * pullBack,
      kiteZ + wingDirZ * KITE_HALF_SPAN - dirZ * pullBack
    );
  }
}
