import * as THREE from 'three';
import type { InputState, PhysicsState, TrickEvent, TrickStyle } from './types';
import { normalizeAngleRad } from './physics';

export type TrickPose =
  | 'NONE'
  | 'INDY_GRAB'
  | 'BOARD_OFF'
  | 'SUPERMAN'
  | 'HANDLEPASS';

export interface TrickVisualState {
  pose: TrickPose;
  poseBlend: number;
  rollAngle: number;
  spinAngle: number;
  boardOffset: number;
}

export interface TrickSummaryState {
  score: number;
  comboPoints: number;
  multiplier: number;
  comboCount: number;
  comboTimer: number;
  comboMaxTime: number;
  bestCombo: number;
  tricksLanded: number;
  styleRating: string;
  activeTricks: string[];
}

const MAX_MULTIPLIER = 10;
const COMBO_DECAY_SECONDS = 4.2;

/**
 * Tracks airborne rotations, grabs, kiteloops, wave-lip boosts, and landings.
 * Manages combo chaining, multiplier escalation (up to 10x), style ratings,
 * and procedural animation pose signals for RiderAndKiteRig.
 */
export class TrickSystem {
  private score = 0;
  private pendingComboPoints = 0;
  private multiplier = 1;
  private comboCount = 0;
  private comboTimer = 0;
  private bestCombo = 0;
  private tricksLanded = 0;
  private styleRating = '';
  private activeTricks: string[] = [];

  private prevAirborne = false;
  private prevWipeout = false;
  private prevBoardYaw = 0;
  private prevMaxHeight = 0;
  private prevWaterForwardSlope = 0;

  // Per-jump tracking
  private signedRotationAccum = 0;
  private awardedRotations = 0;
  private rotationDir = 0; // -1 = backroll, +1 = frontroll
  private kiteloopAwardedThisLoop = false;
  private kiteloopCountThisAir = 0;

  // Grab/pose state
  private activePose: TrickPose = 'NONE';
  private poseHoldTime = 0;
  private poseAwarded = new Set<TrickPose>();
  private poseBlend = 0;
  private rollAngle = 0;
  private spinAngle = 0;
  private boardOffset = 0;

  private readonly _fwd = new THREE.Vector3();

  /** Reset all scoring, combo, and pose state for a fresh run. */
  public reset(): void {
    this.score = 0;
    this.pendingComboPoints = 0;
    this.multiplier = 1;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
    this.tricksLanded = 0;
    this.styleRating = '';
    this.activeTricks = [];

    this.prevAirborne = false;
    this.prevWipeout = false;
    this.prevBoardYaw = 0;
    this.prevMaxHeight = 0;
    this.prevWaterForwardSlope = 0;

    this.resetAirState();
  }

  private resetAirState(): void {
    this.signedRotationAccum = 0;
    this.awardedRotations = 0;
    this.rotationDir = 0;
    this.kiteloopAwardedThisLoop = false;
    this.kiteloopCountThisAir = 0;
    this.activePose = 'NONE';
    this.poseHoldTime = 0;
    this.poseAwarded.clear();
    this.rollAngle = 0;
    this.spinAngle = 0;
    this.boardOffset = 0;
  }

  /**
   * Advance trick detection, combo multiplier timers, and procedural trick visual pose.
   * Returns newly triggered TrickEvent items from this frame.
   */
  public update(
    dt: number,
    physics: PhysicsState,
    input: InputState,
    waveLipLaunched?: boolean
  ): TrickEvent[] {
    const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
    const events: TrickEvent[] = [];

    // Compute wave-slope alignment while on water so we can detect Wave-Lip launches.
    if (!physics.isAirborne) {
      this._fwd.set(Math.sin(physics.heading), 0, -Math.cos(physics.heading));
      this.prevWaterForwardSlope = -this._fwd.dot(physics.waterNormalAtPlayer);
    }

    // 1. Wipeout handling (breaks active combo).
    if (physics.wipeout && !this.prevWipeout) {
      const lostPoints = this.pendingComboPoints;
      this.pendingComboPoints = 0;
      this.multiplier = 1;
      this.comboCount = 0;
      this.comboTimer = 0;
      this.styleRating = '';
      this.activeTricks = [];
      this.resetAirState();

      if (lostPoints > 0) {
        events.push({
          name: 'WIPEOUT! COMBO LOST',
          points: 0,
          multiplierDelta: 0,
          style: 'LANDING',
        });
      }
    }
    this.prevWipeout = physics.wipeout;

    if (physics.wipeout) {
      this.poseBlend = THREE.MathUtils.lerp(this.poseBlend, 0, 10 * clampedDt);
      this.prevAirborne = physics.isAirborne;
      this.prevBoardYaw = physics.boardYaw;
      return events;
    }

    // 2. Takeoff transition.
    if (physics.isAirborne && !this.prevAirborne) {
      this.resetAirState();
      this.prevBoardYaw = physics.boardYaw;
      this.prevMaxHeight = physics.currentJumpHeight;
      this.activeTricks = [];

      const isWaveLip =
        waveLipLaunched ?? (this.prevWaterForwardSlope > 0.065 && physics.velocity.y > 9);
      if (isWaveLip) {
        events.push(this.recordTrick('WAVE-LIP BOOST!', 300, 1, 'COMBO'));
      }
    }

    // 3. Airborne trick detection.
    if (physics.isAirborne) {
      this.comboTimer = COMBO_DECAY_SECONDS;
      this.prevMaxHeight = Math.max(this.prevMaxHeight, physics.maxJumpHeightThisAir);

      this.updateRotations(clampedDt, physics, input, events);
      this.updatePoses(clampedDt, input, events);
      this.updateKiteloopTracking(physics, events);
    } else if (this.prevAirborne) {
      // 4. Touchdown transition (clean landing!).
      this.handleCleanLanding(events);
    } else {
      // 5. On water: decay combo timer cleanly.
      if (this.comboTimer > 0) {
        this.comboTimer -= clampedDt;
        if (this.comboTimer <= 0) {
          this.comboTimer = 0;
          this.multiplier = 1;
          this.comboCount = 0;
          this.styleRating = '';
          this.activeTricks = [];
        }
      }
      this.poseBlend = THREE.MathUtils.lerp(this.poseBlend, 0, 12 * clampedDt);
      this.rollAngle = THREE.MathUtils.lerp(this.rollAngle, 0, 12 * clampedDt);
      this.spinAngle = THREE.MathUtils.lerp(this.spinAngle, 0, 12 * clampedDt);
      this.boardOffset = THREE.MathUtils.lerp(this.boardOffset, 0, 12 * clampedDt);
    }

    this.prevAirborne = physics.isAirborne;
    this.prevBoardYaw = physics.boardYaw;
    return events;
  }

  private updateRotations(
    dt: number,
    physics: PhysicsState,
    input: InputState,
    events: TrickEvent[]
  ): void {
    const yawDelta = normalizeAngleRad(physics.boardYaw - this.prevBoardYaw);

    if (Math.abs(input.trickDir.x) > 0.25) {
      const dir = input.trickDir.x < 0 ? -1 : 1;
      if (this.rotationDir === 0 || Math.sign(this.signedRotationAccum) === dir) {
        this.rotationDir = dir;
      }
      // Integrate both board yaw spin and visual roll flip smoothly.
      const rate = Math.max(Math.abs(yawDelta), 6.2 * dt);
      this.signedRotationAccum += dir * rate;
      this.rollAngle = normalizeAngleRad(this.rollAngle + dir * 6.6 * dt);
    } else {
      // Smoothly return roll angle toward upright when rotation key released.
      this.rollAngle = THREE.MathUtils.lerp(this.rollAngle, 0, 1 - Math.exp(-9 * dt));
    }

    const totalDeg = THREE.MathUtils.radToDeg(Math.abs(this.signedRotationAccum));
    const completedSpins = Math.floor((totalDeg + 65) / 360);

    if (completedSpins > this.awardedRotations) {
      this.awardedRotations = completedSpins;
      const isBackroll = this.signedRotationAccum < 0;
      const degLabel = completedSpins * 360;
      const prefix =
        completedSpins === 1
          ? `${degLabel}`
          : completedSpins === 2
          ? `${degLabel} DOUBLE`
          : completedSpins === 3
          ? `${degLabel} TRIPLE`
          : completedSpins === 4
          ? `${degLabel} QUAD`
          : `${degLabel} ${completedSpins}X`;
      const name = `${prefix} ${isBackroll ? 'BACKROLL' : 'FRONTROLL'}`;
      const points = 450 * completedSpins;
      events.push(this.recordTrick(name, points, 1, 'ROTATION'));
    }
  }

  private updatePoses(
    dt: number,
    input: InputState,
    events: TrickEvent[]
  ): void {
    const tx = input.trickDir.x;
    const ty = input.trickDir.y;

    let desiredPose: TrickPose = 'NONE';
    if (Math.abs(ty) > 0.35 && Math.abs(tx) > 0.35) {
      desiredPose = ty > 0 ? 'SUPERMAN' : 'HANDLEPASS';
    } else if (ty > 0.35) {
      desiredPose = this.poseHoldTime > 0.85 ? 'SUPERMAN' : 'BOARD_OFF';
    } else if (ty < -0.35) {
      desiredPose = this.poseHoldTime > 0.85 ? 'HANDLEPASS' : 'INDY_GRAB';
    }

    if (desiredPose !== 'NONE') {
      if (desiredPose === this.activePose || this.isUpgradePose(this.activePose, desiredPose)) {
        this.poseHoldTime += dt;
      } else {
        this.poseHoldTime = dt;
      }
      this.activePose = desiredPose;
      this.poseBlend = THREE.MathUtils.lerp(this.poseBlend, 1, 1 - Math.exp(-14 * dt));

      if (this.activePose === 'BOARD_OFF') {
        this.boardOffset = THREE.MathUtils.lerp(this.boardOffset, 1, 1 - Math.exp(-12 * dt));
      } else {
        this.boardOffset = THREE.MathUtils.lerp(this.boardOffset, 0, 1 - Math.exp(-12 * dt));
      }

      if (this.activePose === 'HANDLEPASS') {
        this.spinAngle = normalizeAngleRad(this.spinAngle + 8.5 * dt);
      } else {
        this.spinAngle = THREE.MathUtils.lerp(this.spinAngle, 0, 1 - Math.exp(-10 * dt));
      }

      if (this.poseHoldTime >= 0.18 && !this.poseAwarded.has(this.activePose)) {
        this.poseAwarded.add(this.activePose);
        events.push(this.emitPoseTrick(this.activePose));
      }
    } else {
      this.poseHoldTime = 0;
      this.activePose = 'NONE';
      this.poseBlend = THREE.MathUtils.lerp(this.poseBlend, 0, 1 - Math.exp(-11 * dt));
      this.boardOffset = THREE.MathUtils.lerp(this.boardOffset, 0, 1 - Math.exp(-12 * dt));
      this.spinAngle = THREE.MathUtils.lerp(this.spinAngle, 0, 1 - Math.exp(-10 * dt));
    }
  }

  private isUpgradePose(prev: TrickPose, next: TrickPose): boolean {
    return (
      (prev === 'BOARD_OFF' && next === 'SUPERMAN') ||
      (prev === 'INDY_GRAB' && next === 'HANDLEPASS')
    );
  }

  private emitPoseTrick(pose: TrickPose): TrickEvent {
    switch (pose) {
      case 'INDY_GRAB':
        return this.recordTrick('INDY GRAB', 280, 1, 'GRAB');
      case 'BOARD_OFF':
        return this.recordTrick('BOARD-OFF', 420, 1, 'GRAB');
      case 'SUPERMAN':
        return this.recordTrick('SUPERMAN', 650, 1, 'GRAB');
      case 'HANDLEPASS':
        return this.recordTrick('HANDLEPASS', 780, 2, 'GRAB');
      default:
        return this.recordTrick('STYLISH GRAB', 200, 1, 'GRAB');
    }
  }

  private updateKiteloopTracking(physics: PhysicsState, events: TrickEvent[]): void {
    if (!physics.inKiteloop) {
      this.kiteloopAwardedThisLoop = false;
      return;
    }

    // Award the loop once the kite reaches the catch arc (>= 0.68 progress).
    if (!this.kiteloopAwardedThisLoop && physics.kiteloopProgress >= 0.68) {
      this.kiteloopAwardedThisLoop = true;
      this.kiteloopCountThisAir += 1;

      const h = Math.max(physics.currentJumpHeight, physics.maxJumpHeightThisAir);
      let name = 'KITELOOP';
      let pts = 650;
      let multDelta = 1;

      if (this.kiteloopCountThisAir >= 2) {
        name = 'DOUBLE KITELOOP!';
        pts = 1400;
        multDelta = 2;
      } else if (h >= 20) {
        name = 'HELI-LOOP!';
        pts = 950;
        multDelta = 2;
      } else if (h >= 9.5) {
        name = 'MEGA KITELOOP!';
        pts = 1150;
        multDelta = 2;
      }

      events.push(this.recordTrick(name, pts, multDelta, 'KITELOOP'));
    }
  }

  private handleCleanLanding(events: TrickEvent[]): void {
    const height = this.prevMaxHeight;
    const hadAirTricks = this.pendingComboPoints > 0;

    if (height >= 2.0 || hadAirTricks) {
      // Big Air height bonus!
      const heightPoints = Math.round(height * 35);
      const isKingAir = height >= 28;
      const isMegaBoost = height >= 16;

      let landingName = 'CLEAN LANDING!';
      if (isKingAir) {
        landingName = `KING OF THE AIR! ${height.toFixed(1)}m`;
        this.styleRating = 'KING OF THE AIR!';
      } else if (isMegaBoost) {
        landingName = `MEGA BOOST! ${height.toFixed(1)}m`;
        this.styleRating = 'MEGA BOOST!';
      } else if (hadAirTricks) {
        landingName = 'STEEZY LANDING!';
        this.styleRating = 'STEEZY!';
      }

      const landingBasePts = 150 + heightPoints;
      const multBefore = this.multiplier;
      const comboTotal = Math.round((this.pendingComboPoints + landingBasePts) * multBefore);

      this.score += comboTotal;
      this.bestCombo = Math.max(this.bestCombo, comboTotal);
      this.tricksLanded += Math.max(1, this.comboCount);
      this.pendingComboPoints = 0;
      this.comboTimer = COMBO_DECAY_SECONDS;

      events.push({
        name: landingName,
        points: comboTotal,
        multiplierDelta: 0,
        style: 'LANDING',
      });
    }

    this.resetAirState();
  }

  private recordTrick(
    name: string,
    basePoints: number,
    multiplierDelta: number,
    style: TrickStyle
  ): TrickEvent {
    const prevMult = this.multiplier;
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + multiplierDelta);
    const actualDelta = this.multiplier - prevMult;

    this.comboCount += 1;
    this.pendingComboPoints += basePoints;
    this.comboTimer = COMBO_DECAY_SECONDS;
    this.activeTricks.push(name);
    if (this.activeTricks.length > 6) {
      this.activeTricks.shift();
    }

    if (this.comboCount >= 5) {
      this.styleRating = 'KING OF THE AIR!';
    } else if (this.comboCount >= 3) {
      this.styleRating = 'MEGA BOOST!';
    } else {
      this.styleRating = 'STEEZY!';
    }

    return {
      name,
      points: basePoints * this.multiplier,
      multiplierDelta: actualDelta,
      style,
    };
  }

  /**
   * Inject a world/environment trick bonus (e.g., Sky Ring pass, Kicker Ramp launch)
   * into the active combo & multiplier chain.
   */
  public addWorldBonus(
    name: string,
    points: number,
    multiplierDelta = 1,
    style: TrickStyle = 'COMBO'
  ): TrickEvent {
    const prevMult = this.multiplier;
    this.multiplier = Math.min(MAX_MULTIPLIER, this.multiplier + multiplierDelta);
    const actualDelta = this.multiplier - prevMult;
    this.comboTimer = COMBO_DECAY_SECONDS;
    this.comboCount += 1;

    const scaledPoints = points * this.multiplier;
    this.score += scaledPoints;
    this.bestCombo = Math.max(this.bestCombo, scaledPoints);

    return {
      name,
      points: scaledPoints,
      multiplierDelta: actualDelta,
      style,
    };
  }

  /** Current procedural trick pose and roll/spin angles for RiderAndKiteRig. */
  public getVisualState(): TrickVisualState {
    return {
      pose: this.activePose,
      poseBlend: this.poseBlend,
      rollAngle: this.rollAngle,
      spinAngle: this.spinAngle,
      boardOffset: this.boardOffset,
    };
  }

  /** Current scoring, combo multiplier, decay timer, and style rating snapshot. */
  public getStatus(): TrickSummaryState {
    return {
      score: this.score,
      comboPoints: this.pendingComboPoints,
      multiplier: this.multiplier,
      comboCount: this.comboCount,
      comboTimer: this.comboTimer,
      comboMaxTime: COMBO_DECAY_SECONDS,
      bestCombo: this.bestCombo,
      tricksLanded: this.tricksLanded,
      styleRating: this.styleRating,
      activeTricks: [...this.activeTricks],
    };
  }

  public getScore(): number {
    return this.score;
  }

  public getMultiplier(): number {
    return this.multiplier;
  }

  public getBestCombo(): number {
    return this.bestCombo;
  }

  public getTricksLanded(): number {
    return this.tricksLanded;
  }
}
