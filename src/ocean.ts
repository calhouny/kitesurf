import * as THREE from 'three';
import type { WaveHeightFn, WaveSample } from './types.ts';

interface GerstnerWaveConfig {
  dirX: number;
  dirZ: number;
  amplitude: number;
  wavelength: number;
  steepness: number;
  speedMult: number;
}

interface DerivedWave {
  dirX: number;
  dirZ: number;
  amplitude: number;
  k: number;
  steepness: number;
  omega: number;
  hAmp: number;
  slopeAmp: number;
}

const RAW_WAVES: readonly GerstnerWaveConfig[] = [
  { dirX: 0.48, dirZ: -0.88, amplitude: 0.82, wavelength: 50.0, steepness: 0.16, speedMult: 1.0 },
  { dirX: -0.45, dirZ: -0.89, amplitude: 0.44, wavelength: 25.5, steepness: 0.14, speedMult: 1.06 },
  { dirX: 0.26, dirZ: -0.96, amplitude: 0.21, wavelength: 13.2, steepness: 0.12, speedMult: 1.12 },
  { dirX: -0.78, dirZ: -0.62, amplitude: 0.095, wavelength: 7.4, steepness: 0.09, speedMult: 1.18 },
];

const WAVES: readonly DerivedWave[] = RAW_WAVES.map((w) => {
  const len = Math.hypot(w.dirX, w.dirZ) || 1;
  const dirX = w.dirX / len;
  const dirZ = w.dirZ / len;
  const k = (Math.PI * 2) / w.wavelength;
  const omega = Math.sqrt(9.81 * k) * w.speedMult;
  return {
    dirX,
    dirZ,
    amplitude: w.amplitude,
    k,
    steepness: w.steepness,
    omega,
    hAmp: w.steepness / k,
    slopeAmp: k * w.amplitude,
  };
});

const INNER_HALF = 160;
const INNER_SEGS = 160; // 2m grid cell
const OUTER_HALF = 1280;
const OUTER_SEGS = 128; // 20m grid cell
const SNAP_STEP = 20; // Common grid step (10 * 2m == 20m) so inner & outer stay aligned

const WIND_STREAK_COUNT = 84;
const WIND_BOX_HALF_XZ = 64;
const WIND_Y_MIN = 1.5;
const WIND_Y_MAX = 44;

const SUN_DIRECTION = new THREE.Vector3(0.42, 0.36, -0.83).normalize();

const SKY_COLOR_GLSL = /* glsl */ `
vec3 computeSkyColor(vec3 dir, vec3 sunDir, float time) {
  float h = clamp(dir.y, -0.05, 1.0);
  float sunDot = max(dot(dir, sunDir), 0.0);

  // Tropical golden-hour sky gradient
  vec3 zenithCol = vec3(0.06, 0.34, 0.72);
  vec3 midCol = vec3(0.16, 0.65, 0.90);
  vec3 horizonCool = vec3(0.58, 0.88, 0.94);
  vec3 horizonWarm = vec3(1.00, 0.78, 0.52);

  float horizonMix = pow(1.0 - max(h, 0.0), 3.4);
  float midMix = smoothstep(0.02, 0.55, max(h, 0.0));
  vec3 sky = mix(midCol, zenithCol, midMix);

  // Sunward warm golden glow along horizon
  vec2 horizDir = normalize(vec2(dir.x, dir.z) + vec2(1e-5));
  vec2 horizSun = normalize(vec2(sunDir.x, sunDir.z) + vec2(1e-5));
  float sunAzimuthAlign = clamp(dot(horizDir, horizSun) * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizonCol = mix(horizonCool, horizonWarm, pow(sunAzimuthAlign, 1.6) * 0.82);

  sky = mix(sky, horizonCol, horizonMix);

  // Atmospheric Mie scattering corona around sun
  float mieWide = pow(sunDot, 7.0);
  float mieTight = pow(sunDot, 64.0);
  sky += vec3(1.0, 0.68, 0.34) * mieWide * 0.32;
  sky += vec3(1.0, 0.92, 0.76) * mieTight * 0.65;

  return sky;
}
`;

const OCEAN_VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform vec2 uWaveDir[4];
uniform vec4 uWaveData[4]; // x: amplitude, y: k, z: steepness, w: omega

attribute vec4 aStitch; // x: offsetA, y: offsetB, z: mixT, w: mode (0=normal, 1=Z-edge, 2=X-edge)

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;
varying float vJacobian;

void evalGerstner(
  vec2 worldXZ,
  out vec3 disp,
  out vec3 normalOut,
  out float jacobianOut
) {
  disp = vec3(0.0);
  vec3 tx = vec3(1.0, 0.0, 0.0);
  vec3 tz = vec3(0.0, 0.0, 1.0);

  for (int i = 0; i < 4; i++) {
    vec2 d = uWaveDir[i];
    float amp = uWaveData[i].x;
    float k = uWaveData[i].y;
    float steep = uWaveData[i].z;
    float omega = uWaveData[i].w;
    float hAmp = steep / k;
    float slopeAmp = k * amp;

    float theta = k * dot(d, worldXZ) - omega * uTime;
    float s = sin(theta);
    float c = cos(theta);

    disp.x += hAmp * d.x * c;
    disp.y += amp * s;
    disp.z += hAmp * d.y * c;

    tx.x -= steep * d.x * d.x * s;
    tx.y += slopeAmp * d.x * c;
    tx.z -= steep * d.x * d.y * s;

    tz.x -= steep * d.x * d.y * s;
    tz.y += slopeAmp * d.y * c;
    tz.z -= steep * d.y * d.y * s;
  }

  normalOut = normalize(cross(tz, tx));
  jacobianOut = tx.x * tz.z - tx.z * tz.x;
}

void main() {
  vec4 baseWorld = modelMatrix * vec4(position, 1.0);
  vec2 worldXZ = baseWorld.xz;

  vec3 disp;
  vec3 waveNormal;
  float jacobian;

  if (aStitch.w < 0.5) {
    evalGerstner(worldXZ, disp, waveNormal, jacobian);
  } else {
    vec2 xzA = worldXZ;
    vec2 xzB = worldXZ;
    if (aStitch.w < 1.5) {
      xzA.y += aStitch.x;
      xzB.y += aStitch.y;
    } else {
      xzA.x += aStitch.x;
      xzB.x += aStitch.y;
    }
    vec3 dispA, normA;
    vec3 dispB, normB;
    float jacA, jacB;
    evalGerstner(xzA, dispA, normA, jacA);
    evalGerstner(xzB, dispB, normB, jacB);
    disp = mix(dispA, dispB, aStitch.z);
    waveNormal = normalize(mix(normA, normB, aStitch.z));
    jacobian = mix(jacA, jacB, aStitch.z);
  }

  vec3 displacedWorld = baseWorld.xyz + disp;
  vWorldPos = displacedWorld;
  vWaveNormal = waveNormal;
  vWaveHeight = disp.y;
  vJacobian = jacobian;

  gl_Position = projectionMatrix * viewMatrix * vec4(displacedWorld, 1.0);
}
`;

const OCEAN_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uPlayerPos;
uniform float uWindSpeed;

varying vec3 vWorldPos;
varying vec3 vWaveNormal;
varying float vWaveHeight;
varying float vJacobian;

${SKY_COLOR_GLSL}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += amp * valueNoise(p);
    p = rot * p * 2.03 + vec2(17.1, 31.7);
    amp *= 0.5;
  }
  return v;
}

vec2 computeMicroRipple(vec2 worldXZ, float t, float distFade) {
  vec2 uv1 = worldXZ * 0.42 + vec2(t * 0.55, -t * 0.72);
  vec2 uv2 = worldXZ * 0.88 + vec2(-t * 0.68, -t * 0.49);
  float e = 0.14;
  float h0 = valueNoise(uv1) * 0.65 + valueNoise(uv2) * 0.35;
  float hx = valueNoise(uv1 + vec2(e, 0.0)) * 0.65 + valueNoise(uv2 + vec2(e, 0.0)) * 0.35;
  float hz = valueNoise(uv1 + vec2(0.0, e)) * 0.65 + valueNoise(uv2 + vec2(0.0, e)) * 0.35;
  return vec2(h0 - hx, h0 - hz) * (1.1 * distFade);
}

void main() {
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);

  float detailFade = 1.0 / (1.0 + dist * 0.012);
  vec2 micro = computeMicroRipple(vWorldPos.xz, uTime, detailFade);
  vec3 N = normalize(vWaveNormal + vec3(micro.x, 0.0, micro.y) * 0.24);

  // Tropical water body colors
  vec3 deepOcean = vec3(0.008, 0.17, 0.34);
  vec3 midOcean = vec3(0.018, 0.40, 0.56);
  vec3 crestTurquoise = vec3(0.05, 0.79, 0.76);

  float depthFactor = smoothstep(-0.85, 0.95, vWaveHeight);
  vec3 waterColor = mix(deepOcean, midOcean, depthFactor);

  // Subsurface turquoise scattering at backlit / sunlit wave crests
  vec3 scatterDir = normalize(-uSunDir + N * 0.42);
  float forwardScatter = pow(max(dot(V, scatterDir), 0.0), 3.0);
  float crestGlow = smoothstep(0.05, 1.15, vWaveHeight);
  float sunSlope = max(dot(N, uSunDir), 0.0) * 0.55 + 0.45;
  float sssIntensity = (forwardScatter * 0.85 + 0.38) * crestGlow * sunSlope;
  waterColor = mix(waterColor, crestTurquoise, clamp(sssIntensity * 0.85, 0.0, 0.92));

  // Crisp Fresnel sky reflection
  float NdotV = max(dot(N, V), 0.0);
  float fresnel = 0.025 + 0.975 * pow(1.0 - NdotV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.015);
  vec3 skyReflect = computeSkyColor(normalize(R), uSunDir, uTime);
  vec3 color = mix(waterColor, skyReflect, clamp(fresnel * 0.92, 0.0, 0.92));

  // Dynamic specular sun glints
  vec3 H = normalize(uSunDir + V);
  float NdotH = max(dot(N, H), 0.0);
  float specSharp = pow(NdotH, 320.0) * 3.8;
  float specBroad = pow(NdotH, 36.0) * 0.42;
  color += vec3(1.0, 0.95, 0.80) * specSharp + vec3(1.0, 0.76, 0.46) * specBroad;

  // Organic foam whitecaps on wave crests and pinched slopes
  float windChopBoost = clamp((uWindSpeed - 10.0) * 0.015, 0.0, 0.16);
  float pinchFactor = smoothstep(0.24, 0.62, 1.0 - vJacobian);
  float heightFactor = smoothstep(0.58 - windChopBoost, 1.28, vWaveHeight);
  float foamNoise = fbm(vWorldPos.xz * 0.24 + vec2(uTime * 0.12, -uTime * 0.22));
  float foamMask = clamp(heightFactor * 0.65 + pinchFactor * 0.60, 0.0, 1.0);
  float foam = smoothstep(0.46, 0.76, foamMask * (0.55 + 0.85 * foamNoise));
  // Fade distant foam gently to avoid high-frequency aliasing
  foam *= smoothstep(650.0, 120.0, dist);
  vec3 foamColor = mix(vec3(0.86, 0.97, 0.99), vec3(1.0, 0.99, 0.96), max(dot(N, uSunDir), 0.0));
  color = mix(color, foamColor, foam * 0.92);

  // Subtle projected rider contact shadow on water directly under player
  vec2 shadowTargetXZ = uPlayerPos.xz - uSunDir.xz * (max(uPlayerPos.y - vWorldPos.y, 0.0) / max(uSunDir.y, 0.2));
  float altFade = smoothstep(18.0, 0.4, max(uPlayerPos.y - vWorldPos.y, 0.0));
  float shadowDist = length(vWorldPos.xz - shadowTargetXZ);
  float shadowRadius = mix(0.95, 2.4, clamp((uPlayerPos.y - vWorldPos.y) / 14.0, 0.0, 1.0));
  float riderShadow = (1.0 - smoothstep(shadowRadius * 0.35, shadowRadius, shadowDist)) * altFade * 0.34;
  color *= (1.0 - riderShadow);

  // Seamless atmospheric horizon haze matching Sky Dome
  float fogT = smoothstep(380.0, 1180.0, dist);
  vec3 horizonDir = normalize(vec3(vWorldPos.x - cameraPosition.x, 0.008, vWorldPos.z - cameraPosition.z));
  vec3 horizonSky = computeSkyColor(horizonDir, uSunDir, uTime);
  color = mix(color, horizonSky, fogT);

  gl_FragColor = vec4(color, 1.0);
}
`;

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vLocalDir;

void main() {
  vLocalDir = normalize(position);
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;

varying vec3 vLocalDir;

${SKY_COLOR_GLSL}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
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

float cloudFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = p * 2.07 + vec2(9.2, 5.7);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize(vLocalDir);
  vec3 color = computeSkyColor(dir, uSunDir, uTime);

  // Crisp glowing solar disc
  float sunDot = dot(dir, uSunDir);
  float sunDisc = smoothstep(0.9986, 0.9995, sunDot);
  float sunHalo = pow(max(sunDot, 0.0), 180.0);
  color += vec3(1.0, 0.93, 0.72) * sunHalo * 0.85;
  color = mix(color, vec3(1.0, 0.99, 0.93) * 1.45, sunDisc);

  // Drifting tropical trade-wind clouds above the horizon
  if (dir.y > 0.025) {
    vec2 cloudUV = dir.xz / (dir.y + 0.16) * 0.85 + vec2(uTime * 0.008, -uTime * 0.018);
    float c = cloudFbm(cloudUV * 1.6);
    float cloudDensity = smoothstep(0.52, 0.82, c) * smoothstep(0.025, 0.18, dir.y) * smoothstep(0.95, 0.25, dir.y);
    float sunLit = 0.65 + 0.35 * max(sunDot, 0.0);
    vec3 cloudCol = mix(vec3(0.86, 0.93, 0.99), vec3(1.0, 0.90, 0.76), pow(max(sunDot, 0.0), 2.5) * sunLit);
    color = mix(color, cloudCol, cloudDensity * 0.62);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

const ISLAND_VERTEX_SHADER = /* glsl */ `
attribute vec3 color;
varying vec3 vColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vColor = color;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const ISLAND_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;

varying vec3 vColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

${SKY_COLOR_GLSL}

void main() {
  vec3 N = normalize(vWorldNormal);
  float sunDiff = max(dot(N, uSunDir), 0.0);
  vec3 ambient = mix(vec3(0.24, 0.42, 0.56), vec3(0.45, 0.68, 0.82), N.y * 0.5 + 0.5);
  vec3 lit = vColor * (ambient * 0.85 + vec3(1.0, 0.91, 0.76) * sunDiff * 1.15);

  float dist = length(cameraPosition - vWorldPos);
  float fogT = smoothstep(320.0, 1180.0, dist);
  vec3 horizonDir = normalize(vec3(vWorldPos.x - cameraPosition.x, 0.02, vWorldPos.z - cameraPosition.z));
  vec3 hazeColor = computeSkyColor(horizonDir, uSunDir, uTime);
  vec3 finalColor = mix(lit, hazeColor, fogT * 0.84);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

const WIND_STREAK_VERTEX_SHADER = /* glsl */ `
attribute float aPhase;
varying vec2 vUv;
varying float vPhase;

void main() {
  vUv = uv;
  vPhase = aPhase;
  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const WIND_STREAK_FRAGMENT_SHADER = /* glsl */ `
uniform float uAlphaScale;
varying vec2 vUv;
varying float vPhase;

void main() {
  // Tapered streak ribbon profile
  float along = sin(vUv.x * 3.14159265);
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float pulse = sin(vPhase * 3.14159265);
  float alpha = pow(along, 1.4) * pow(across, 1.6) * pulse * uAlphaScale;
  if (alpha < 0.01) discard;
  vec3 col = mix(vec3(0.75, 0.96, 1.0), vec3(1.0, 0.99, 0.94), along);
  gl_FragColor = vec4(col, alpha);
}
`;

interface WindStreakData {
  offsetX: number;
  y: number;
  offsetZ: number;
  speedMult: number;
  length: number;
  phase: number;
  phaseSpeed: number;
}

export class OceanSystem {
  public readonly waveHeightFn: WaveHeightFn;

  private readonly scene: THREE.Scene;
  private readonly oceanMaterial: THREE.ShaderMaterial;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly islandMaterial: THREE.ShaderMaterial;
  private readonly streakMaterial: THREE.ShaderMaterial;

  private readonly innerOceanMesh: THREE.Mesh;
  private readonly outerOceanMesh: THREE.Mesh;
  private readonly skyDomeMesh: THREE.Mesh;
  private readonly islandsGroup: THREE.Group;
  private readonly windStreaksMesh: THREE.InstancedMesh;

  private readonly sunLight: THREE.DirectionalLight;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly fillLight: THREE.DirectionalLight;

  private readonly streakData: WindStreakData[] = [];
  private readonly streakDummy = new THREE.Object3D();
  private readonly streakPhaseAttr: THREE.InstancedBufferAttribute;
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  private lastTime = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.waveHeightFn = (x: number, z: number, time: number): WaveSample =>
      this.getWaveHeightAndNormal(x, z, time);

    const waveDirs = WAVES.map((w) => new THREE.Vector2(w.dirX, w.dirZ));
    const waveData = WAVES.map((w) => new THREE.Vector4(w.amplitude, w.k, w.steepness, w.omega));

    // 1. Ocean ShaderMaterial shared by inner detail mesh and outer horizon skirt
    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIRECTION.clone() },
        uPlayerPos: { value: new THREE.Vector3() },
        uWindSpeed: { value: 14.0 },
        uWaveDir: { value: waveDirs },
        uWaveData: { value: waveData },
      },
      vertexShader: OCEAN_VERTEX_SHADER,
      fragmentShader: OCEAN_FRAGMENT_SHADER,
    });
    this.disposableMaterials.push(this.oceanMaterial);

    const innerGeo = this.createOceanGridGeometry(INNER_HALF, INNER_SEGS, 0, true);
    const outerGeo = this.createOceanGridGeometry(OUTER_HALF, OUTER_SEGS, INNER_HALF, false);
    this.disposableGeometries.push(innerGeo, outerGeo);

    this.innerOceanMesh = new THREE.Mesh(innerGeo, this.oceanMaterial);
    this.innerOceanMesh.frustumCulled = false;
    this.innerOceanMesh.renderOrder = 0;
    this.scene.add(this.innerOceanMesh);

    this.outerOceanMesh = new THREE.Mesh(outerGeo, this.oceanMaterial);
    this.outerOceanMesh.frustumCulled = false;
    this.outerOceanMesh.renderOrder = 0;
    this.scene.add(this.outerOceanMesh);

    // 2. Golden-hour Tropical Sky Dome
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.disposableMaterials.push(this.skyMaterial);

    const skyGeo = new THREE.SphereGeometry(1800, 48, 28);
    this.disposableGeometries.push(skyGeo);
    this.skyDomeMesh = new THREE.Mesh(skyGeo, this.skyMaterial);
    this.skyDomeMesh.frustumCulled = false;
    this.skyDomeMesh.renderOrder = -10;
    this.scene.add(this.skyDomeMesh);

    // 3. Distant Scenic Volcanic Islands & Coral Atolls on the Horizon
    this.islandMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: SUN_DIRECTION.clone() },
      },
      vertexShader: ISLAND_VERTEX_SHADER,
      fragmentShader: ISLAND_FRAGMENT_SHADER,
    });
    this.disposableMaterials.push(this.islandMaterial);

    this.islandsGroup = this.createHorizonIslands();
    this.scene.add(this.islandsGroup);

    // 4. Animated Wind Streaks in the Air
    this.streakMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uAlphaScale: { value: 0.36 },
      },
      vertexShader: WIND_STREAK_VERTEX_SHADER,
      fragmentShader: WIND_STREAK_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.disposableMaterials.push(this.streakMaterial);

    const streakGeo = this.createCrossStreakGeometry();
    this.disposableGeometries.push(streakGeo);

    const phases = new Float32Array(WIND_STREAK_COUNT);
    this.streakPhaseAttr = new THREE.InstancedBufferAttribute(phases, 1);
    streakGeo.setAttribute('aPhase', this.streakPhaseAttr);

    this.windStreaksMesh = new THREE.InstancedMesh(
      streakGeo,
      this.streakMaterial,
      WIND_STREAK_COUNT
    );
    this.windStreaksMesh.frustumCulled = false;
    this.windStreaksMesh.renderOrder = 4;
    this.initWindStreaks();
    this.scene.add(this.windStreaksMesh);

    // 5. Tropical Lighting (Hemisphere + Shadowed Golden Sunlight + Cool Fill)
    this.hemiLight = new THREE.HemisphereLight(0x74ccff, 0x179da6, 1.05);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d2, 2.25);
    this.sunLight.position.copy(SUN_DIRECTION).multiplyScalar(120);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 260;
    this.sunLight.shadow.camera.left = -45;
    this.sunLight.shadow.camera.right = 45;
    this.sunLight.shadow.camera.top = 45;
    this.sunLight.shadow.camera.bottom = -45;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.03;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.fillLight = new THREE.DirectionalLight(0x9be6ff, 0.48);
    this.fillLight.position.set(-55, 42, 70);
    this.scene.add(this.fillLight);
  }

  /**
   * Computes the exact ocean wave height and surface normal at world (x, z) and time.
   * Uses 3 Newton-Raphson iterations to invert the Gerstner horizontal displacement so
   * the CPU surface matches the GPU vertex shader to sub-millimeter accuracy.
   */
  public getWaveHeightAndNormal(x: number, z: number, time: number): WaveSample {
    let x0 = x;
    let z0 = z;

    for (let iter = 0; iter < 3; iter++) {
      let dx = 0;
      let dz = 0;
      let j00 = 1;
      let j01 = 0;
      let j11 = 1;

      for (let i = 0; i < 4; i++) {
        const w = WAVES[i];
        const theta = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * time;
        const s = Math.sin(theta);
        const c = Math.cos(theta);

        dx += w.hAmp * w.dirX * c;
        dz += w.hAmp * w.dirZ * c;

        j00 -= w.steepness * w.dirX * w.dirX * s;
        j01 -= w.steepness * w.dirX * w.dirZ * s;
        j11 -= w.steepness * w.dirZ * w.dirZ * s;
      }

      const fx = x0 + dx - x;
      const fz = z0 + dz - z;
      const det = j00 * j11 - j01 * j01;
      const invDet = det !== 0 ? 1 / det : 1;

      x0 -= (j11 * fx - j01 * fz) * invDet;
      z0 -= (-j01 * fx + j00 * fz) * invDet;
    }

    let height = 0;
    let txX = 1;
    let txY = 0;
    let txZ = 0;
    let tzX = 0;
    let tzY = 0;
    let tzZ = 1;

    for (let i = 0; i < 4; i++) {
      const w = WAVES[i];
      const theta = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * time;
      const s = Math.sin(theta);
      const c = Math.cos(theta);

      height += w.amplitude * s;

      txX -= w.steepness * w.dirX * w.dirX * s;
      txY += w.slopeAmp * w.dirX * c;
      txZ -= w.steepness * w.dirX * w.dirZ * s;

      tzX -= w.steepness * w.dirX * w.dirZ * s;
      tzY += w.slopeAmp * w.dirZ * c;
      tzZ -= w.steepness * w.dirZ * w.dirZ * s;
    }

    // Cross product: tangentZ x tangentX points upward (+Y)
    const nx = tzY * txZ - tzZ * txY;
    const ny = tzZ * txX - tzX * txZ;
    const nz = tzX * txY - tzY * txX;
    const len = Math.hypot(nx, ny, nz) || 1;

    return {
      height,
      normal: new THREE.Vector3(nx / len, ny / len, nz / len),
    };
  }

  public update(
    time: number,
    playerPos: THREE.Vector3,
    windDir = 0,
    windSpeed = 14,
    dt?: number
  ): void {
    const stepDt =
      dt !== undefined ? dt : Math.max(0, Math.min(0.1, time - this.lastTime));
    this.lastTime = time;

    // Update shader time & state uniforms
    this.oceanMaterial.uniforms.uTime.value = time;
    this.oceanMaterial.uniforms.uPlayerPos.value.copy(playerPos);
    this.oceanMaterial.uniforms.uWindSpeed.value = windSpeed;
    this.skyMaterial.uniforms.uTime.value = time;
    this.islandMaterial.uniforms.uTime.value = time;

    // Snap ocean grids to common 20m world increments so vertices never swim
    const snappedX = Math.round(playerPos.x / SNAP_STEP) * SNAP_STEP;
    const snappedZ = Math.round(playerPos.z / SNAP_STEP) * SNAP_STEP;
    this.innerOceanMesh.position.set(snappedX, 0, snappedZ);
    this.outerOceanMesh.position.set(snappedX, 0, snappedZ);

    // Keep sky dome and distant horizon islands centered around player XZ
    this.skyDomeMesh.position.set(playerPos.x, 0, playerPos.z);
    this.islandsGroup.position.set(playerPos.x, 0, playerPos.z);

    // Keep directional sun shadow frustum centered & texel-snapped around player
    const shadowSnap = 0.5;
    const targetX = Math.round(playerPos.x / shadowSnap) * shadowSnap;
    const targetZ = Math.round(playerPos.z / shadowSnap) * shadowSnap;
    this.sunLight.target.position.set(targetX, 0, targetZ);
    this.sunLight.target.updateMatrixWorld();
    this.sunLight.position
      .copy(this.sunLight.target.position)
      .addScaledVector(SUN_DIRECTION, 120);

    // Animate wind streaks along windDir at windSpeed
    this.updateWindStreaks(stepDt, playerPos, windDir, windSpeed);
  }

  public getSunDirection(): THREE.Vector3 {
    return SUN_DIRECTION.clone();
  }

  public dispose(): void {
    this.scene.remove(
      this.innerOceanMesh,
      this.outerOceanMesh,
      this.skyDomeMesh,
      this.islandsGroup,
      this.windStreaksMesh,
      this.hemiLight,
      this.sunLight,
      this.sunLight.target,
      this.fillLight
    );
    for (const geo of this.disposableGeometries) {
      geo.dispose();
    }
    for (const mat of this.disposableMaterials) {
      mat.dispose();
    }
  }

  private createOceanGridGeometry(
    halfSize: number,
    segments: number,
    holeHalfSize: number,
    stitchOuterEdge: boolean
  ): THREE.BufferGeometry {
    const step = (halfSize * 2) / segments;
    const stride = segments + 1;
    const vertexCount = stride * stride;

    const positions = new Float32Array(vertexCount * 3);
    const stitches = new Float32Array(vertexCount * 4);

    for (let iz = 0; iz <= segments; iz++) {
      const z = -halfSize + iz * step;
      for (let ix = 0; ix <= segments; ix++) {
        const x = -halfSize + ix * step;
        const vIdx = iz * stride + ix;

        positions[vIdx * 3] = x;
        positions[vIdx * 3 + 1] = 0;
        positions[vIdx * 3 + 2] = z;

        if (stitchOuterEdge) {
          const onLeftRight = ix === 0 || ix === segments;
          const onTopBottom = iz === 0 || iz === segments;
          if (onLeftRight && !onTopBottom) {
            const localCell = Math.floor((z + halfSize) / SNAP_STEP);
            const z0 = -halfSize + localCell * SNAP_STEP;
            const z1 = z0 + SNAP_STEP;
            const t = (z - z0) / SNAP_STEP;
            if (t > 0.001 && t < 0.999) {
              stitches[vIdx * 4] = z0 - z;
              stitches[vIdx * 4 + 1] = z1 - z;
              stitches[vIdx * 4 + 2] = t;
              stitches[vIdx * 4 + 3] = 1.0;
            }
          } else if (onTopBottom && !onLeftRight) {
            const localCell = Math.floor((x + halfSize) / SNAP_STEP);
            const x0 = -halfSize + localCell * SNAP_STEP;
            const x1 = x0 + SNAP_STEP;
            const t = (x - x0) / SNAP_STEP;
            if (t > 0.001 && t < 0.999) {
              stitches[vIdx * 4] = x0 - x;
              stitches[vIdx * 4 + 1] = x1 - x;
              stitches[vIdx * 4 + 2] = t;
              stitches[vIdx * 4 + 3] = 2.0;
            }
          }
        }
      }
    }

    const indices: number[] = [];
    for (let iz = 0; iz < segments; iz++) {
      const zCenter = -halfSize + (iz + 0.5) * step;
      for (let ix = 0; ix < segments; ix++) {
        const xCenter = -halfSize + (ix + 0.5) * step;
        if (
          holeHalfSize > 0 &&
          Math.abs(xCenter) < holeHalfSize &&
          Math.abs(zCenter) < holeHalfSize
        ) {
          continue;
        }
        const a = iz * stride + ix;
        const b = (iz + 1) * stride + ix;
        const c = iz * stride + (ix + 1);
        const d = (iz + 1) * stride + (ix + 1);

        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aStitch', new THREE.BufferAttribute(stitches, 4));
    geo.setIndex(indices);
    return geo;
  }

  private createHorizonIslands(): THREE.Group {
    const group = new THREE.Group();

    const islandSpecs = [
      { angle: -0.66, dist: 860, radius: 135, height: 112, seed: 1.7, isAtoll: false },
      { angle: 0.78, dist: 920, radius: 118, height: 128, seed: 4.3, isAtoll: false },
      { angle: 0.22, dist: 810, radius: 92, height: 22, seed: 7.1, isAtoll: true },
      { angle: -2.15, dist: 940, radius: 145, height: 95, seed: 11.4, isAtoll: false },
      { angle: 2.25, dist: 910, radius: 120, height: 74, seed: 15.8, isAtoll: false },
    ];

    for (const spec of islandSpecs) {
      const island = this.buildVolcanicIslandMesh(
        spec.radius,
        spec.height,
        spec.seed,
        spec.isAtoll
      );
      island.position.set(
        Math.sin(spec.angle) * spec.dist,
        -2.2,
        -Math.cos(spec.angle) * spec.dist
      );
      island.rotation.y = spec.seed;
      group.add(island);

      // Shallow turquoise coral lagoon ring encircling each island
      const reefGeo = new THREE.RingGeometry(spec.radius * 0.78, spec.radius * 1.48, 36);
      reefGeo.rotateX(-Math.PI / 2);
      const reefColors = new Float32Array(reefGeo.attributes.position.count * 3);
      for (let i = 0; i < reefGeo.attributes.position.count; i++) {
        reefColors[i * 3] = 0.14;
        reefColors[i * 3 + 1] = 0.84;
        reefColors[i * 3 + 2] = 0.80;
      }
      reefGeo.setAttribute('color', new THREE.BufferAttribute(reefColors, 3));
      this.disposableGeometries.push(reefGeo);

      const reefMesh = new THREE.Mesh(reefGeo, this.islandMaterial);
      reefMesh.position.set(island.position.x, -0.35, island.position.z);
      reefMesh.frustumCulled = false;
      group.add(reefMesh);
    }

    return group;
  }

  private buildVolcanicIslandMesh(
    radius: number,
    height: number,
    seed: number,
    isAtoll: boolean
  ): THREE.Mesh {
    const radialSegs = 40;
    const heightSegs = 14;
    const geo = new THREE.ConeGeometry(radius, height, radialSegs, heightSegs, false);
    geo.translate(0, height * 0.5, 0);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    const sandColor = new THREE.Color(0xf2d99b);
    const jungleColor = new THREE.Color(0x1f6b3b);
    const highJungleColor = new THREE.Color(0x2f8042);
    const rockColor = new THREE.Color(0x4a454a);
    const tmpColor = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);

      const angle = Math.atan2(z, x);
      const normY = Math.max(0, Math.min(1, y / height));
      const r = Math.hypot(x, z);

      // Sculpt ridged volcanic profile and organic shoreline
      const ridge1 = Math.sin(angle * 3 + seed) * 0.18;
      const ridge2 = Math.cos(angle * 7 - seed * 1.4) * 0.09;
      const ridge3 = Math.sin(angle * 11 + normY * 4.5 + seed) * 0.05;
      const radialWarp = 1.0 + (ridge1 + ridge2 + ridge3) * (1.0 - normY * 0.35);

      if (r > 0.001) {
        // Concave volcanic skirt curve
        const profile = isAtoll
          ? Math.pow(1 - normY, 0.55)
          : Math.pow(1 - normY, 1.35) * (1 - normY) + (1 - normY) * 0.45;
        const targetR = radius * profile * radialWarp;
        const scale = targetR / r;
        x *= scale;
        z *= scale;
      }

      if (!isAtoll && normY > 0.86) {
        // Slight volcanic caldera / jagged twin crest dip at the summit
        y -= (normY - 0.86) * height * (0.45 + 0.35 * Math.sin(angle * 2 + seed));
      }

      pos.setXYZ(i, x, y, z);

      // Assign tropical altitude vertex colors
      if (y < 4.5) {
        tmpColor.copy(sandColor);
      } else if (y < height * 0.58) {
        const t = (y - 4.5) / Math.max(1, height * 0.58 - 4.5);
        tmpColor.copy(jungleColor).lerp(highJungleColor, t);
      } else {
        const t = (y - height * 0.58) / Math.max(1, height * 0.42);
        tmpColor.copy(highJungleColor).lerp(rockColor, Math.min(1, t * 1.35));
      }

      colors[i * 3] = tmpColor.r;
      colors[i * 3 + 1] = tmpColor.g;
      colors[i * 3 + 2] = tmpColor.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    this.disposableGeometries.push(geo);

    const mesh = new THREE.Mesh(geo, this.islandMaterial);
    mesh.frustumCulled = false;
    return mesh;
  }

  private createCrossStreakGeometry(): THREE.BufferGeometry {
    const hw = 0.065;
    // Two intersecting quads (XZ horizontal + XY vertical) so streaks read from any view angle
    const positions = new Float32Array([
      -0.5, 0, -hw, 0.5, 0, -hw, 0.5, 0, hw, -0.5, 0, hw,
      -0.5, -hw, 0, 0.5, -hw, 0, 0.5, hw, 0, -0.5, hw, 0,
    ]);
    const uvs = new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 1,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    return geo;
  }

  private initWindStreaks(): void {
    const phases = this.streakPhaseAttr.array as Float32Array;
    for (let i = 0; i < WIND_STREAK_COUNT; i++) {
      const phase = Math.random();
      this.streakData.push({
        offsetX: (Math.random() * 2 - 1) * WIND_BOX_HALF_XZ,
        y: WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN),
        offsetZ: (Math.random() * 2 - 1) * WIND_BOX_HALF_XZ,
        speedMult: 0.85 + Math.random() * 0.55,
        length: 5.5 + Math.random() * 7.5,
        phase,
        phaseSpeed: 0.45 + Math.random() * 0.45,
      });
      phases[i] = phase;
    }
    this.streakPhaseAttr.needsUpdate = true;
  }

  private updateWindStreaks(
    dt: number,
    playerPos: THREE.Vector3,
    windDir: number,
    windSpeed: number
  ): void {
    const dirX = Math.sin(windDir);
    const dirZ = -Math.cos(windDir);
    const boxSize = WIND_BOX_HALF_XZ * 2;
    const speedFactor = 1.35;
    const phases = this.streakPhaseAttr.array as Float32Array;

    this.streakMaterial.uniforms.uAlphaScale.value = THREE.MathUtils.clamp(
      0.16 + (windSpeed / 25) * 0.28,
      0.14,
      0.48
    );

    for (let i = 0; i < WIND_STREAK_COUNT; i++) {
      const s = this.streakData[i];
      const move = windSpeed * speedFactor * s.speedMult * dt;
      s.offsetX += dirX * move;
      s.offsetZ += dirZ * move;
      s.phase += s.phaseSpeed * dt;

      if (s.phase >= 1) {
        s.phase -= 1;
        s.offsetX = (Math.random() * 2 - 1) * WIND_BOX_HALF_XZ;
        s.offsetZ = (Math.random() * 2 - 1) * WIND_BOX_HALF_XZ;
        s.y = WIND_Y_MIN + Math.random() * (WIND_Y_MAX - WIND_Y_MIN);
      }

      // Wrap smoothly inside player-relative wind volume
      if (s.offsetX > WIND_BOX_HALF_XZ) s.offsetX -= boxSize;
      if (s.offsetX < -WIND_BOX_HALF_XZ) s.offsetX += boxSize;
      if (s.offsetZ > WIND_BOX_HALF_XZ) s.offsetZ -= boxSize;
      if (s.offsetZ < -WIND_BOX_HALF_XZ) s.offsetZ += boxSize;

      phases[i] = s.phase;

      // PlaneGeometry lies in XZ with length along X; align X axis to wind vector (dirX, 0, dirZ)
      this.streakDummy.position.set(
        playerPos.x + s.offsetX,
        s.y,
        playerPos.z + s.offsetZ
      );
      this.streakDummy.rotation.set(0, Math.atan2(-dirZ, dirX), 0);
      this.streakDummy.scale.set(
        s.length * (0.7 + windSpeed * 0.03),
        1,
        1
      );
      this.streakDummy.updateMatrix();
      this.windStreaksMesh.setMatrixAt(i, this.streakDummy.matrix);
    }

    this.windStreaksMesh.instanceMatrix.needsUpdate = true;
    this.streakPhaseAttr.needsUpdate = true;
  }
}
