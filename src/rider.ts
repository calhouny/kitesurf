import * as THREE from 'three';
import type { KiteGear, PhysicsState } from './types';
import { computeKiteOffset, KITE_LINE_LENGTH } from './physics';
import type { TrickVisualState } from './tricks';

const DEFAULT_GEAR: KiteGear = {
  id: 'starter',
  name: 'Tradewind Pro',
  kiteColorPrimary: '#00d2ff',
  kiteColorSecondary: '#ff5e3a',
  boardColor: '#111827',
  boostBonus: 0,
  turnSpeedBonus: 0,
  hangtimeBonus: 0,
  cost: 0,
};

interface LineEntry {
  line: THREE.Line;
  positions: Float32Array;
  geometry: THREE.BufferGeometry;
}

const _tmpRiderPos = new THREE.Vector3();
const _tmpKitePos = new THREE.Vector3();
const _tmpRadial = new THREE.Vector3();
const _tmpWindFwd = new THREE.Vector3();
const _tmpWindRight = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpFwd = new THREE.Vector3();
const _tmpRotMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpRollQuat = new THREE.Quaternion();
const _tmpPivotOffset = new THREE.Vector3();

const _tmpStart = new THREE.Vector3();
const _tmpEnd = new THREE.Vector3();
const _tmpBarLeft = new THREE.Vector3();
const _tmpBarRight = new THREE.Vector3();
const _tmpBarCenter = new THREE.Vector3();
const _tmpHarness = new THREE.Vector3();
const _tmpKiteFL = new THREE.Vector3();
const _tmpKiteFR = new THREE.Vector3();
const _tmpKiteRL = new THREE.Vector3();
const _tmpKiteRR = new THREE.Vector3();

/**
 * Articulated 3D kitesurfer character, twin-tip kiteboard, curved SLE/C-kite canopy,
 * and 4 dynamic tension-reactive dyneema flying lines.
 */
export class RiderAndKiteRig {
  public readonly group = new THREE.Group();

  // Top-level sub-groups
  private readonly riderRoot = new THREE.Group();
  private readonly flipPivot = new THREE.Group();
  private readonly boardGroup = new THREE.Group();
  private readonly kiteGroup = new THREE.Group();
  private readonly linesGroup = new THREE.Group();

  // Articulated character pivots
  private readonly pelvisGroup = new THREE.Group();
  private readonly torsoGroup = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly leftHip = new THREE.Group();
  private readonly leftKnee = new THREE.Group();
  private readonly rightHip = new THREE.Group();
  private readonly rightKnee = new THREE.Group();
  private readonly leftShoulder = new THREE.Group();
  private readonly leftElbow = new THREE.Group();
  private readonly rightShoulder = new THREE.Group();
  private readonly rightElbow = new THREE.Group();
  private readonly controlBarGroup = new THREE.Group();

  // World-space anchor markers
  private readonly barLeftAnchor = new THREE.Object3D();
  private readonly barRightAnchor = new THREE.Object3D();
  private readonly barCenterAnchor = new THREE.Object3D();
  private readonly harnessAnchor = new THREE.Object3D();
  private readonly chickenLoopLine: THREE.Line;
  private readonly chickenLoopPositions = new Float32Array(6);

  private readonly kiteFLAnchor = new THREE.Object3D();
  private readonly kiteFRAnchor = new THREE.Object3D();
  private readonly kiteRLAnchor = new THREE.Object3D();
  private readonly kiteRRAnchor = new THREE.Object3D();

  private readonly boardLeftSprayAnchor = new THREE.Object3D();
  private readonly boardRightSprayAnchor = new THREE.Object3D();
  private readonly boardTailAnchor = new THREE.Object3D();

  // Shared materials updated dynamically when equipping KiteGear
  private readonly kitePrimaryMat: THREE.MeshStandardMaterial;
  private readonly kiteSecondaryMat: THREE.MeshStandardMaterial;
  private readonly kiteStrutMat: THREE.MeshStandardMaterial;
  private readonly boardDeckMat: THREE.MeshStandardMaterial;
  private readonly helmetMat: THREE.MeshStandardMaterial;
  private readonly lineMaterial: THREE.LineBasicMaterial;

  private readonly flyingLines: LineEntry[] = [];
  private readonly lineSegments = 7;

  private gear: KiteGear;

  constructor(scene?: THREE.Scene, initialGear: KiteGear = DEFAULT_GEAR) {
    this.gear = initialGear;

    this.kitePrimaryMat = new THREE.MeshStandardMaterial({
      color: initialGear.kiteColorPrimary,
      roughness: 0.36,
      metalness: 0.06,
      side: THREE.DoubleSide,
    });
    this.kiteSecondaryMat = new THREE.MeshStandardMaterial({
      color: initialGear.kiteColorSecondary,
      roughness: 0.34,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    this.kiteStrutMat = new THREE.MeshStandardMaterial({
      color: '#18202c',
      roughness: 0.45,
      metalness: 0.12,
    });
    this.boardDeckMat = new THREE.MeshStandardMaterial({
      color: initialGear.boardColor,
      roughness: 0.28,
      metalness: 0.15,
    });
    this.helmetMat = new THREE.MeshStandardMaterial({
      color: initialGear.kiteColorPrimary,
      roughness: 0.25,
      metalness: 0.2,
    });
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: '#e6f7ff',
      transparent: true,
      opacity: 0.8,
    });

    const chickenGeo = new THREE.BufferGeometry();
    chickenGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.chickenLoopPositions, 3)
    );
    this.chickenLoopLine = new THREE.Line(
      chickenGeo,
      new THREE.LineBasicMaterial({ color: '#ff9f1c' })
    );

    this.buildBoard();
    this.buildRider();
    this.buildKite();
    this.buildFlyingLines();

    this.riderRoot.rotation.order = 'YXZ';
    this.flipPivot.position.set(0, 0.85, 0);
    this.riderRoot.add(this.boardGroup);
    this.riderRoot.add(this.flipPivot);
    this.flipPivot.add(this.pelvisGroup);
    this.riderRoot.add(this.chickenLoopLine);

    this.group.add(this.riderRoot);
    this.group.add(this.kiteGroup);
    this.group.add(this.linesGroup);

    if (scene) {
      scene.add(this.group);
    }
  }

  /** Return root group containing rider, kite, and flying lines. */
  public getGroup(): THREE.Group {
    return this.group;
  }

  /** Toggle head/helmet visibility so first-person POV camera is unobstructed. */
  public setFirstPersonMode(enabled: boolean): void {
    this.headGroup.visible = !enabled;
  }

  /** Apply a KiteGear colorway smoothly to the kite canopy, helmet, and twin-tip board. */
  public applyGear(gear: KiteGear): void {
    this.gear = gear;
    this.kitePrimaryMat.color.set(gear.kiteColorPrimary);
    this.kiteSecondaryMat.color.set(gear.kiteColorSecondary);
    this.boardDeckMat.color.set(gear.boardColor);
    this.helmetMat.color.set(gear.kiteColorPrimary);
  }

  /** Get current equipped gear reference. */
  public getGear(): KiteGear {
    return this.gear;
  }

  private buildBoard(): void {
    // Sleek twin-tip kiteboard (length along Z, width along X).
    const deckGeo = new THREE.BoxGeometry(0.42, 0.032, 1.38, 2, 1, 10);
    const pos = deckGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const x = pos.getX(i);
      const y = pos.getY(i);
      const normZ = z / 0.69; // -1..+1
      // Taper width smoothly toward rounded twin tips
      const widthTaper = 1 - 0.32 * Math.pow(Math.abs(normZ), 2.4);
      // Upward rocker curvature toward nose/tail
      const rocker = 0.065 * Math.pow(Math.abs(normZ), 2.4);
      pos.setX(i, x * widthTaper);
      pos.setY(i, y + rocker);
    }
    deckGeo.computeVertexNormals();

    const deckMesh = new THREE.Mesh(deckGeo, this.boardDeckMat);
    deckMesh.castShadow = true;
    deckMesh.receiveShadow = true;
    this.boardGroup.add(deckMesh);

    // Colorful graphic rail stripe
    const stripeMat = this.kiteSecondaryMat;
    const stripeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.036, 1.05),
      stripeMat
    );
    stripeMesh.position.y = 0.004;
    this.boardGroup.add(stripeMesh);

    // Two ergonomic footstraps + EVA foam pads
    const padMat = new THREE.MeshStandardMaterial({
      color: '#1f2937',
      roughness: 0.75,
    });
    const strapMat = this.kitePrimaryMat;

    for (const zOff of [-0.28, 0.28]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.16), padMat);
      pad.position.set(0, 0.026, zOff);
      pad.rotation.y = zOff < 0 ? -0.18 : 0.18;
      this.boardGroup.add(pad);

      const strap = new THREE.Mesh(
        new THREE.TorusGeometry(0.065, 0.016, 8, 14, Math.PI),
        strapMat
      );
      strap.position.set(0, 0.032, zOff);
      strap.rotation.y = Math.PI * 0.5 + (zOff < 0 ? -0.18 : 0.18);
      this.boardGroup.add(strap);
    }

    // Center grab handle for Board-Off tricks
    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.06, 0.01, 6, 12, Math.PI),
      this.kiteStrutMat
    );
    handle.position.set(0.04, 0.025, 0);
    handle.rotation.y = Math.PI * 0.5;
    this.boardGroup.add(handle);

    // 4 twin-tip fins underneath
    const finGeo = new THREE.BoxGeometry(0.014, 0.055, 0.09);
    for (const [fx, fz] of [
      [-0.12, -0.52],
      [0.12, -0.52],
      [-0.12, 0.52],
      [0.12, 0.52],
    ]) {
      const fin = new THREE.Mesh(finGeo, this.kiteSecondaryMat);
      fin.position.set(fx, -0.02, fz);
      this.boardGroup.add(fin);
    }

    // Spray & wake anchors on board
    this.boardLeftSprayAnchor.position.set(-0.22, 0, 0.1);
    this.boardRightSprayAnchor.position.set(0.22, 0, 0.1);
    this.boardTailAnchor.position.set(0, 0, 0.68);
    this.boardGroup.add(
      this.boardLeftSprayAnchor,
      this.boardRightSprayAnchor,
      this.boardTailAnchor
    );

    this.boardGroup.position.set(0, 0.04, 0);
  }

  private buildRider(): void {
    const skinMat = new THREE.MeshStandardMaterial({
      color: '#e4a678',
      roughness: 0.6,
    });
    const wetsuitMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.55,
    });
    const vestMat = this.kiteSecondaryMat;
    const harnessMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.4,
    });
    const hookMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      metalness: 0.85,
      roughness: 0.2,
    });
    const shadesMat = new THREE.MeshStandardMaterial({
      color: '#090d16',
      metalness: 0.7,
      roughness: 0.15,
    });

    // Pelvis centered relative to flipPivot (flipPivot is at y = 0.85)
    this.pelvisGroup.position.set(0, 0, 0);

    const pelvisMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.14, 0.1, 6, 12),
      wetsuitMat
    );
    pelvisMesh.castShadow = true;
    this.pelvisGroup.add(pelvisMesh);

    // Waist harness + spreader hook
    const harness = new THREE.Mesh(
      new THREE.CylinderGeometry(0.165, 0.17, 0.18, 12),
      harnessMat
    );
    harness.position.y = 0.08;
    harness.castShadow = true;
    this.pelvisGroup.add(harness);

    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.008, 6, 10), hookMat);
    hook.position.set(0, 0.09, -0.17);
    this.pelvisGroup.add(hook);

    this.harnessAnchor.position.set(0, 0.09, -0.19);
    this.pelvisGroup.add(this.harnessAnchor);

    // Torso
    this.torsoGroup.position.set(0, 0.12, 0);
    this.pelvisGroup.add(this.torsoGroup);

    const chest = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.155, 0.28, 8, 14),
      wetsuitMat
    );
    chest.position.y = 0.24;
    chest.castShadow = true;
    this.torsoGroup.add(chest);

    const impactVest = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.34, 0.24),
      vestMat
    );
    impactVest.position.y = 0.25;
    impactVest.castShadow = true;
    this.torsoGroup.add(impactVest);

    // Head, Helmet & Sunglasses
    this.headGroup.position.set(0, 0.54, 0);
    this.torsoGroup.add(this.headGroup);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), skinMat);
    head.castShadow = true;
    this.headGroup.add(head);

    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.138, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this.helmetMat
    );
    helmet.position.y = 0.012;
    helmet.castShadow = true;
    this.headGroup.add(helmet);

    const shades = new THREE.Mesh(
      new THREE.BoxGeometry(0.19, 0.052, 0.09),
      shadesMat
    );
    shades.position.set(0, 0.02, -0.095);
    this.headGroup.add(shades);

    // Legs (mounted inside pelvisGroup)
    this.buildLeg(this.leftHip, this.leftKnee, -0.05, -0.22, wetsuitMat, this.kitePrimaryMat);
    this.buildLeg(this.rightHip, this.rightKnee, 0.05, 0.22, wetsuitMat, this.kitePrimaryMat);

    // Arms (mounted inside torsoGroup) + Control Bar (mounted inside flipPivot so bar tracks kite)
    this.buildArm(this.leftShoulder, this.leftElbow, -0.21, wetsuitMat, skinMat);
    this.buildArm(this.rightShoulder, this.rightElbow, 0.21, wetsuitMat, skinMat);

    this.controlBarGroup.position.set(0, 0.36, -0.46);
    this.flipPivot.add(this.controlBarGroup);

    const barShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.54, 10),
      harnessMat
    );
    barShaft.rotation.z = Math.PI * 0.5;
    barShaft.castShadow = true;
    this.controlBarGroup.add(barShaft);

    const leftGrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8),
      this.kiteSecondaryMat
    );
    leftGrip.rotation.z = Math.PI * 0.5;
    leftGrip.position.x = -0.2;
    this.controlBarGroup.add(leftGrip);

    const rightGrip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.14, 8),
      this.kitePrimaryMat
    );
    rightGrip.rotation.z = Math.PI * 0.5;
    rightGrip.position.x = 0.2;
    this.controlBarGroup.add(rightGrip);

    this.barLeftAnchor.position.set(-0.27, 0, 0);
    this.barRightAnchor.position.set(0.27, 0, 0);
    this.barCenterAnchor.position.set(0, 0.03, 0);
    this.controlBarGroup.add(
      this.barLeftAnchor,
      this.barRightAnchor,
      this.barCenterAnchor
    );
  }

  private buildLeg(
    hipGroup: THREE.Group,
    kneeGroup: THREE.Group,
    sideXOffset: number,
    sideZOffset: number,
    wetsuitMat: THREE.Material,
    bootMat: THREE.Material
  ): void {
    // Staggered stance anchored over front/rear twin-tip footstraps
    hipGroup.position.set(sideXOffset, -0.05, sideZOffset);
    this.pelvisGroup.add(hipGroup);

    const thigh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.072, 0.34, 6, 10),
      wetsuitMat
    );
    thigh.position.y = -0.2;
    thigh.castShadow = true;
    hipGroup.add(thigh);

    kneeGroup.position.set(0, -0.4, 0);
    hipGroup.add(kneeGroup);

    const shin = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.056, 0.34, 6, 10),
      wetsuitMat
    );
    shin.position.y = -0.2;
    shin.castShadow = true;
    kneeGroup.add(shin);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.22), bootMat);
    boot.position.set(0, -0.41, -0.04);
    boot.castShadow = true;
    kneeGroup.add(boot);
  }

  private buildArm(
    shoulderGroup: THREE.Group,
    elbowGroup: THREE.Group,
    xOffset: number,
    wetsuitMat: THREE.Material,
    skinMat: THREE.Material
  ): void {
    shoulderGroup.position.set(xOffset, 0.38, 0);
    this.torsoGroup.add(shoulderGroup);

    const upperArm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.05, 0.24, 6, 10),
      wetsuitMat
    );
    upperArm.position.y = -0.14;
    upperArm.castShadow = true;
    shoulderGroup.add(upperArm);

    elbowGroup.position.set(0, -0.28, 0);
    shoulderGroup.add(elbowGroup);

    const forearm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.042, 0.22, 6, 10),
      skinMat
    );
    forearm.position.y = -0.13;
    forearm.castShadow = true;
    elbowGroup.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.046, 8, 8), skinMat);
    hand.position.y = -0.27;
    elbowGroup.add(hand);
  }

  private buildKite(): void {
    // Parametric curved C-shape / SLE inflatable canopy (local Y = canopy normal away from rider,
    // local Z = chord from leading edge (+Z, upwind) to trailing edge (-Z, downwind), local X = span).
    const spanSegs = 18;
    const chordSegs = 6;
    const halfSpan = 2.6;
    const chordCenter = 1.45;
    const arcRadius = 2.35;
    const maxArcAngle = 1.08;

    const createPanelSlice = (
      uStart: number,
      uEnd: number,
      segsU: number,
      material: THREE.Material
    ): THREE.Mesh => {
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (let iu = 0; iu <= segsU; iu++) {
        const tU = iu / segsU;
        const u = THREE.MathUtils.lerp(uStart, uEnd, tU); // -1..+1
        const theta = u * maxArcAngle;
        const absU = Math.abs(u);

        const localChord = chordCenter * (1 - 0.42 * Math.pow(absU, 1.8));
        const sweepZ = 0.45 * Math.pow(absU, 2.0);

        for (let iv = 0; iv <= chordSegs; iv++) {
          const v = iv / chordSegs; // 0 = leading edge (+Z), 1 = trailing edge (-Z)
          const x = Math.sin(theta) * arcRadius * (halfSpan / (arcRadius * Math.sin(maxArcAngle)));
          const arcDrop = -(1 - Math.cos(theta)) * arcRadius * 0.85;
          const camber = Math.sin(v * Math.PI) * 0.22 * (1 - 0.35 * absU);
          const y = arcDrop + camber;
          const z = -((v - 0.42) * localChord + sweepZ);

          positions.push(x, y, z);
          uvs.push(tU, v);
        }
      }

      const stride = chordSegs + 1;
      for (let iu = 0; iu < segsU; iu++) {
        for (let iv = 0; iv < chordSegs; iv++) {
          const a = iu * stride + iv;
          const b = (iu + 1) * stride + iv;
          const c = (iu + 1) * stride + (iv + 1);
          const d = iu * stride + (iv + 1);
          indices.push(a, b, d, b, c, d);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = true;
      return mesh;
    };

    // Split canopy into colorful center primary & wingtip secondary panels
    this.kiteGroup.add(createPanelSlice(-1.0, -0.58, 5, this.kiteSecondaryMat));
    this.kiteGroup.add(createPanelSlice(-0.58, -0.22, 4, this.kitePrimaryMat));
    this.kiteGroup.add(createPanelSlice(-0.22, 0.22, 5, this.kiteSecondaryMat));
    this.kiteGroup.add(createPanelSlice(0.22, 0.58, 4, this.kitePrimaryMat));
    this.kiteGroup.add(createPanelSlice(0.58, 1.0, 5, this.kiteSecondaryMat));

    // Inflatable leading edge arc tube (+Z upwind)
    const lePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= spanSegs; i++) {
      const u = -1 + (2 * i) / spanSegs;
      const theta = u * maxArcAngle;
      const absU = Math.abs(u);
      const localChord = chordCenter * (1 - 0.42 * Math.pow(absU, 1.8));
      const sweepZ = 0.45 * Math.pow(absU, 2.0);
      const x = Math.sin(theta) * arcRadius * (halfSpan / (arcRadius * Math.sin(maxArcAngle)));
      const y = -(1 - Math.cos(theta)) * arcRadius * 0.85;
      const z = -(-0.42 * localChord + sweepZ);
      lePoints.push(new THREE.Vector3(x, y, z));
    }
    const leCurve = new THREE.CatmullRomCurve3(lePoints);
    const leTube = new THREE.Mesh(
      new THREE.TubeGeometry(leCurve, 22, 0.085, 8, false),
      this.kiteStrutMat
    );
    leTube.castShadow = true;
    this.kiteGroup.add(leTube);

    // 5 inflatable struts from leading edge (+Z) to trailing edge (-Z)
    for (const u of [-0.72, -0.35, 0, 0.35, 0.72]) {
      const theta = u * maxArcAngle;
      const absU = Math.abs(u);
      const localChord = chordCenter * (1 - 0.42 * Math.pow(absU, 1.8));
      const sweepZ = 0.45 * Math.pow(absU, 2.0);
      const x = Math.sin(theta) * arcRadius * (halfSpan / (arcRadius * Math.sin(maxArcAngle)));
      const yBase = -(1 - Math.cos(theta)) * arcRadius * 0.85;

      const strutPts = [
        new THREE.Vector3(x, yBase, -(-0.42 * localChord + sweepZ)),
        new THREE.Vector3(
          x,
          yBase + 0.16 * (1 - 0.35 * absU),
          -(0.08 * localChord + sweepZ)
        ),
        new THREE.Vector3(x, yBase, -(0.58 * localChord + sweepZ)),
      ];
      const strutGeo = new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(strutPts),
        8,
        0.045,
        6,
        false
      );
      const strut = new THREE.Mesh(strutGeo, this.kiteStrutMat);
      this.kiteGroup.add(strut);
    }

    // 4 bridle & wingtip attachment anchors on underside of kite
    const tipDrop = -(1 - Math.cos(maxArcAngle)) * arcRadius * 0.85;
    const tipZBack = 0.58 * chordCenter * (1 - 0.42) + 0.45;
    const frontDrop = -(1 - Math.cos(0.45 * maxArcAngle)) * arcRadius * 0.85;

    this.kiteFLAnchor.position.set(-1.18, frontDrop - 0.25, 0.42);
    this.kiteFRAnchor.position.set(1.18, frontDrop - 0.25, 0.42);
    this.kiteRLAnchor.position.set(-halfSpan, tipDrop - 0.18, -(tipZBack - 0.1));
    this.kiteRRAnchor.position.set(halfSpan, tipDrop - 0.18, -(tipZBack - 0.1));

    this.kiteGroup.add(
      this.kiteFLAnchor,
      this.kiteFRAnchor,
      this.kiteRLAnchor,
      this.kiteRRAnchor
    );
  }

  private buildFlyingLines(): void {
    for (let i = 0; i < 4; i++) {
      const positions = new Float32Array(this.lineSegments * 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geometry, this.lineMaterial);
      line.frustumCulled = false;
      this.flyingLines.push({ line, positions, geometry });
      this.linesGroup.add(line);
    }
  }

  /** World-space position of kite left wingtip (for wind-ribbon particle trails). */
  public getLeftWingtipWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.kiteRLAnchor.getWorldPosition(out);
    return out;
  }

  /** World-space position of kite right wingtip (for wind-ribbon particle trails). */
  public getRightWingtipWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.kiteRRAnchor.getWorldPosition(out);
    return out;
  }

  /** World-space position of board tail (for wake & spray particle emitters). */
  public getBoardTailWorldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    this.boardTailAnchor.getWorldPosition(out);
    return out;
  }

  /** World-space rail spray anchor positions on left and right sides of the board. */
  public getBoardSprayPositions(
    leftOut = new THREE.Vector3(),
    rightOut = new THREE.Vector3()
  ): void {
    this.boardLeftSprayAnchor.getWorldPosition(leftOut);
    this.boardRightSprayAnchor.getWorldPosition(rightOut);
  }

  /**
   * Update 3D rider posture, procedural trick pose, kite orientation, and 4 dyneema lines.
   */
  public update(
    physics: PhysicsState,
    time: number,
    trickVisual?: TrickVisualState
  ): void {
    // 1. Rider root transform
    _tmpRiderPos.copy(physics.position);
    this.riderRoot.position.copy(_tmpRiderPos);
    this.riderRoot.rotation.set(
      physics.boardPitch,
      -physics.boardYaw,
      -physics.boardRoll,
      'YXZ'
    );

    // 2. Procedural posture, harness lean, knee absorption & mid-air trick poses
    this.updateRiderPose(physics, time, trickVisual);

    // 3. Kite world position & gimbal-free spherical orientation
    computeKiteOffset(
      physics.windDir,
      physics.kiteAzimuth,
      physics.kiteElevation,
      KITE_LINE_LENGTH,
      _tmpKitePos
    );
    _tmpKitePos.add(_tmpRiderPos);
    _tmpKitePos.y = Math.max(_tmpKitePos.y, physics.waterHeightAtPlayer + 2.5);
    this.kiteGroup.position.copy(_tmpKitePos);

    this.orientKite(physics);

    // Update world matrices before reading bar & bridle anchor world coordinates
    this.group.updateMatrixWorld(true);

    // 4. Update chicken loop (local rider space) & 4 world-space dyneema lines
    this.updateChickenLoop();
    this.updateFlyingLines(physics.lineTension);
  }

  private updateRiderPose(
    physics: PhysicsState,
    time: number,
    trickVisual?: TrickVisualState
  ): void {
    const pose = trickVisual?.pose ?? 'NONE';
    const blend = trickVisual?.poseBlend ?? 0;
    const rollAngle = trickVisual?.rollAngle ?? 0;
    const spinAngle = trickVisual?.spinAngle ?? 0;
    const boardOffset = trickVisual?.boardOffset ?? 0;

    if (physics.wipeout) {
      // Comical tumble in splash
      this.flipPivot.rotation.set(
        Math.sin(time * 9) * 0.85,
        time * 6,
        Math.cos(time * 8) * 0.9
      );
      this.torsoGroup.rotation.set(0.3, 0, Math.sin(time * 12) * 0.4);
      this.leftHip.rotation.set(-0.7, 0, -0.35);
      this.rightHip.rotation.set(-0.4, 0, 0.35);
      this.leftKnee.rotation.set(1.1, 0, 0);
      this.rightKnee.rotation.set(0.9, 0, 0);
      this.boardGroup.position.set(0, 0.04, 0);
      this.boardGroup.rotation.set(0, 0, 0);
      return;
    }

    // Flips & spins (backroll/frontroll + handlepass) + subtle airborne pendulum swing
    const pendulumZ =
      physics.isAirborne && pose === 'NONE'
        ? THREE.MathUtils.clamp(
            -THREE.MathUtils.degToRad(physics.kiteAzimuth) * 0.25,
            -0.35,
            0.35
          )
        : 0;
    this.flipPivot.rotation.set(rollAngle, spinAngle, pendulumZ, 'YXZ');

    // Lean back against line tension + carve slightly toward kite azimuth
    const leanBack = 0.2 + physics.lineTension * 0.3;
    const azLean = THREE.MathUtils.degToRad(physics.kiteAzimuth) * 0.16;

    // Knee bend: positive hipX moves knee forward (-Z), negative kneeX brings shin back (+Z)
    const baseKneeBend = physics.isAirborne ? -0.96 : -0.82 - Math.sin(time * 14) * 0.05;
    let hipPitch = 0.42;
    let kneeBend = baseKneeBend;
    let torsoPitch = leanBack;
    let torsoYaw = azLean - 0.18;
    let pelvisY = 0.03;

    if (pose === 'INDY_GRAB') {
      hipPitch = THREE.MathUtils.lerp(hipPitch, 1.35, blend);
      kneeBend = THREE.MathUtils.lerp(kneeBend, -1.95, blend);
      torsoPitch = THREE.MathUtils.lerp(torsoPitch, -0.35, blend);
      pelvisY = THREE.MathUtils.lerp(pelvisY, 0.14, blend);
    } else if (pose === 'BOARD_OFF') {
      hipPitch = THREE.MathUtils.lerp(hipPitch, 0.78, blend);
      kneeBend = THREE.MathUtils.lerp(kneeBend, -1.35, blend);
      torsoPitch = THREE.MathUtils.lerp(torsoPitch, 0.05, blend);
    } else if (pose === 'SUPERMAN') {
      // Body & legs extend horizontally backward (+Z) behind the control bar
      hipPitch = THREE.MathUtils.lerp(hipPitch, -0.15, blend);
      kneeBend = THREE.MathUtils.lerp(kneeBend, -0.18, blend);
      torsoPitch = THREE.MathUtils.lerp(torsoPitch, 1.18, blend);
      pelvisY = THREE.MathUtils.lerp(pelvisY, 0.25, blend);
    } else if (pose === 'HANDLEPASS') {
      hipPitch = THREE.MathUtils.lerp(hipPitch, 0.48, blend);
      kneeBend = THREE.MathUtils.lerp(kneeBend, -0.92, blend);
      torsoPitch = THREE.MathUtils.lerp(torsoPitch, 0.12, blend);
    }

    this.pelvisGroup.position.set(0, pelvisY, 0);
    this.torsoGroup.rotation.set(torsoPitch, torsoYaw, 0, 'YXZ');

    // Legs split cleanly toward front (-Z) & rear (+Z) footstraps
    this.leftHip.rotation.set(hipPitch - 0.1, 0, -0.05);
    this.rightHip.rotation.set(hipPitch + 0.1, 0, 0.05);
    this.leftKnee.rotation.set(kneeBend, 0, 0);
    this.rightKnee.rotation.set(kneeBend, 0, 0);

    // Control bar steers & sheets in front of rider (-Z)
    const sheetDist = -0.48 + (1 - physics.lineTension) * 0.1;
    const supermanShift = pose === 'SUPERMAN' ? -0.18 * blend : 0;
    const barTilt = THREE.MathUtils.clamp(-physics.kiteRoll * 0.45, -0.45, 0.45);
    this.controlBarGroup.position.set(
      0,
      0.38 + (pose === 'SUPERMAN' ? 0.08 * blend : 0),
      sheetDist + supermanShift
    );
    this.controlBarGroup.rotation.set(0, 0, barTilt);

    // Positive shoulderX reaches forward (-Z) to hold control bar
    let lShoulderX = 1.18 - torsoPitch * 0.55;
    let lShoulderZ = -0.16;
    let lElbowX = 0.42;
    let rShoulderX = 1.18 - torsoPitch * 0.55;
    let rShoulderZ = 0.16;
    let rElbowX = 0.42;

    if (pose === 'INDY_GRAB' || pose === 'BOARD_OFF') {
      // Left arm reaches down toward board rail / detached board handle
      lShoulderX = THREE.MathUtils.lerp(lShoulderX, 0.35, blend);
      lShoulderZ = THREE.MathUtils.lerp(lShoulderZ, -0.58, blend);
      lElbowX = THREE.MathUtils.lerp(lElbowX, 0.25, blend);
    } else if (pose === 'SUPERMAN') {
      // Arms extend overhead relative to tilted torso toward bar in front
      lShoulderX = THREE.MathUtils.lerp(lShoulderX, 0.32, blend);
      rShoulderX = THREE.MathUtils.lerp(rShoulderX, 0.32, blend);
      lElbowX = THREE.MathUtils.lerp(lElbowX, 0.15, blend);
      rElbowX = THREE.MathUtils.lerp(rElbowX, 0.15, blend);
    }

    this.leftShoulder.rotation.set(lShoulderX, 0, lShoulderZ);
    this.leftElbow.rotation.set(lElbowX, 0, 0);
    this.rightShoulder.rotation.set(rShoulderX, 0, rShoulderZ);
    this.rightElbow.rotation.set(rElbowX, 0, 0);

    // Head looks slightly up toward kite & forward down ocean corridor
    this.headGroup.rotation.set(
      -torsoPitch * 0.65 + (physics.isAirborne ? -0.1 : 0.05),
      -torsoYaw * 0.5,
      0
    );

    // Detached board offset during Board-Off trick
    this.boardGroup.position.set(
      -0.46 * boardOffset,
      0.04 + 0.52 * boardOffset,
      0.12 * boardOffset
    );
    this.boardGroup.rotation.set(
      0.22 * boardOffset,
      0.45 * boardOffset,
      0.78 * boardOffset
    );
  }

  private orientKite(physics: PhysicsState): void {
    // Gimbal-free spherical tangent frame at kite position
    _tmpRadial.copy(this.kiteGroup.position).sub(this.riderRoot.position).normalize();

    const az = THREE.MathUtils.degToRad(physics.kiteAzimuth);
    _tmpWindFwd.set(Math.sin(physics.windDir), 0, -Math.cos(physics.windDir));
    _tmpWindRight.set(Math.cos(physics.windDir), 0, Math.sin(physics.windDir));

    // Horizontal tangent perpendicular to radial direction in wind window
    _tmpRight
      .copy(_tmpWindRight)
      .multiplyScalar(Math.cos(az))
      .addScaledVector(_tmpWindFwd, -Math.sin(az))
      .normalize();

    // Forward leading-edge axis
    _tmpFwd.crossVectors(_tmpRight, _tmpRadial).normalize();
    // Re-orthogonalize right vector
    _tmpRight.crossVectors(_tmpRadial, _tmpFwd).normalize();

    _tmpRotMatrix.makeBasis(_tmpRight, _tmpRadial, _tmpFwd);
    _tmpQuat.setFromRotationMatrix(_tmpRotMatrix);

    // Apply steering/kiteloop roll around tether radial axis
    _tmpRollQuat.setFromAxisAngle(_tmpRadial, physics.kiteRoll);
    this.kiteGroup.quaternion.copy(_tmpRollQuat).multiply(_tmpQuat);

    // Anchor loop rotation slightly toward inner turning edge without canceling wide sky sweep
    const pivotX = physics.inKiteloop
      ? (physics.kiteRoll >= 0 ? 1 : -1) * 0.55
      : THREE.MathUtils.clamp(physics.kiteRoll * 0.35, -0.65, 0.65);
    _tmpPivotOffset.set(pivotX, 0, 0).applyQuaternion(this.kiteGroup.quaternion);
    this.kiteGroup.position.addScaledVector(_tmpRight, pivotX).sub(_tmpPivotOffset);
  }

  private updateChickenLoop(): void {
    this.harnessAnchor.getWorldPosition(_tmpHarness);
    this.barCenterAnchor.getWorldPosition(_tmpBarCenter);
    this.riderRoot.worldToLocal(_tmpHarness);
    this.riderRoot.worldToLocal(_tmpBarCenter);

    this.chickenLoopPositions[0] = _tmpHarness.x;
    this.chickenLoopPositions[1] = _tmpHarness.y;
    this.chickenLoopPositions[2] = _tmpHarness.z;
    this.chickenLoopPositions[3] = _tmpBarCenter.x;
    this.chickenLoopPositions[4] = _tmpBarCenter.y;
    this.chickenLoopPositions[5] = _tmpBarCenter.z;
    this.chickenLoopLine.geometry.attributes.position.needsUpdate = true;
  }

  private updateFlyingLines(lineTension: number): void {
    this.barLeftAnchor.getWorldPosition(_tmpBarLeft);
    this.barRightAnchor.getWorldPosition(_tmpBarRight);
    this.barCenterAnchor.getWorldPosition(_tmpBarCenter);

    this.kiteFLAnchor.getWorldPosition(_tmpKiteFL);
    this.kiteFRAnchor.getWorldPosition(_tmpKiteFR);
    this.kiteRLAnchor.getWorldPosition(_tmpKiteRL);
    this.kiteRRAnchor.getWorldPosition(_tmpKiteRR);

    // Catenary sag decreases sharply as tension climbs toward 1.0
    const sagAmount = Math.max(0.02, (1 - lineTension) * 1.15);

    this.writeCatenaryLine(this.flyingLines[0], _tmpBarCenter, _tmpKiteFL, sagAmount * 0.75);
    this.writeCatenaryLine(this.flyingLines[1], _tmpBarCenter, _tmpKiteFR, sagAmount * 0.75);
    this.writeCatenaryLine(this.flyingLines[2], _tmpBarLeft, _tmpKiteRL, sagAmount);
    this.writeCatenaryLine(this.flyingLines[3], _tmpBarRight, _tmpKiteRR, sagAmount);

    this.lineMaterial.opacity = THREE.MathUtils.clamp(0.58 + lineTension * 0.36, 0.5, 0.95);
  }

  private writeCatenaryLine(
    entry: LineEntry,
    start: THREE.Vector3,
    end: THREE.Vector3,
    sag: number
  ): void {
    _tmpStart.copy(start);
    _tmpEnd.copy(end);
    const pos = entry.positions;
    const count = this.lineSegments;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = THREE.MathUtils.lerp(_tmpStart.x, _tmpEnd.x, t);
      const y =
        THREE.MathUtils.lerp(_tmpStart.y, _tmpEnd.y, t) -
        Math.sin(t * Math.PI) * sag;
      const z = THREE.MathUtils.lerp(_tmpStart.z, _tmpEnd.z, t);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
    }
    entry.geometry.attributes.position.needsUpdate = true;
  }
}
