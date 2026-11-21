import * as THREE from 'three';
import type { InputState, KiteGear, PhysicsState, WaveHeightFn } from './types';

/** Fixed length of dyneema flying lines from rider bar/harness to kite bridle (meters). */
export const KITE_LINE_LENGTH = 22;

const GRAVITY = 11.4;
const MIN_AZIMUTH_DEG = -85;
const MAX_AZIMUTH_DEG = 85;
const MIN_ELEVATION_DEG = 10;
const MAX_ELEVATION_DEG = 88;
const MAX_HEADING_RAD = THREE.MathUtils.degToRad(62);

const _tmpForward = new THREE.Vector3();
const _tmpWindForward = new THREE.Vector3();
const _tmpWindRight = new THREE.Vector3();
const _tmpKitePullDir = new THREE.Vector3();

/** Normalize an angle in radians into [-PI, PI]. */
export function normalizeAngleRad(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Compute world-space offset from rider to kite given wind direction,
 * azimuth (degrees in [-85, 85]), elevation (degrees in [10, 88]), and tether length.
 * Wind direction 0 blows downwind toward -Z.
 */
export function computeKiteOffset(
  windDir: number,
  kiteAzimuthDeg: number,
  kiteElevationDeg: number,
  lineLength = KITE_LINE_LENGTH,
  out = new THREE.Vector3()
): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(kiteAzimuthDeg);
  const el = THREE.MathUtils.degToRad(kiteElevationDeg);
  const cosEl = Math.cos(el);

  _tmpWindForward.set(Math.sin(windDir), 0, -Math.cos(windDir));
  _tmpWindRight.set(Math.cos(windDir), 0, Math.sin(windDir));

  out
    .set(0, Math.sin(el), 0)
    .addScaledVector(_tmpWindForward, cosEl * Math.cos(az))
    .addScaledVector(_tmpWindRight, cosEl * Math.sin(az))
    .normalize()
    .multiplyScalar(lineLength);

  return out;
}

export interface PhysicsStepOptions {
  autoAssist?: boolean;
  gear?: KiteGear | null;
}

export interface LandingReport {
  clean: boolean;
  maxHeight: number;
  hadKiteloop: boolean;
  speedBoost: number;
}

/**
 * Arcade-authentic 3D kitesurfing physics engine.
 * Models a downwind quarter-sphere wind window, dynamic kite diving power,
 * board edging tension, Big Air zenith pops, Heli/Mega Kiteloops, wave riding,
 * and landing alignment / wipeout recovery.
 */
export class KitePhysicsEngine {
  public readonly state: PhysicsState;

  private autoAssist = false;
  private gear: KiteGear | null = null;
  private baseWindSpeed: number;

  private kiteloopDir = 1;
  private kiteloopBaseAz = 0;
  private kiteloopBaseEl = 55;
  private kiteloopsThisAir = 0;
  private jumpHoldTimer = 0;
  private boardCrouch = 0;
  private prevWaveLipFlag = false;
  private kiteRaiseBlend = 0;
  private kiteAzVel = 0;
  private kiteElVel = 0;
  private steerHoldBlend = 0;
  private headingVel = 0;
  private pendulumAzVel = 0;
  private lastLandingReport: LandingReport | null = null;

  constructor(initialWindSpeed = 14.5) {
    this.baseWindSpeed = initialWindSpeed;
    this.state = this.createInitialState(initialWindSpeed);
  }

  private createInitialState(windSpeed: number): PhysicsState {
    return {
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, -13.5),
      heading: 0,
      boardPitch: 0,
      boardRoll: 0,
      boardYaw: 0,
      kiteAzimuth: 0,
      kiteElevation: 55,
      kiteRoll: 0,
      kiteAngularVel: 0,
      lineTension: 0.45,
      apparentWind: windSpeed + 6,
      windSpeed,
      windDir: 0,
      isAirborne: false,
      airTime: 0,
      currentJumpHeight: 0,
      maxJumpHeightThisAir: 0,
      inKiteloop: false,
      kiteloopProgress: 0,
      waterHeightAtPlayer: 0,
      waterNormalAtPlayer: new THREE.Vector3(0, 1, 0),
      wipeout: false,
      wipeoutTimer: 0,
    };
  }

  /** Reset rider, kite, and motion state for a new run or heat. */
  public reset(windSpeed = this.baseWindSpeed): void {
    const fresh = this.createInitialState(windSpeed);
    this.state.position.copy(fresh.position);
    this.state.velocity.copy(fresh.velocity);
    this.state.heading = fresh.heading;
    this.state.boardPitch = fresh.boardPitch;
    this.state.boardRoll = fresh.boardRoll;
    this.state.boardYaw = fresh.boardYaw;
    this.state.kiteAzimuth = fresh.kiteAzimuth;
    this.state.kiteElevation = fresh.kiteElevation;
    this.state.kiteRoll = fresh.kiteRoll;
    this.state.kiteAngularVel = fresh.kiteAngularVel;
    this.state.lineTension = fresh.lineTension;
    this.state.apparentWind = fresh.apparentWind;
    this.state.windSpeed = fresh.windSpeed;
    this.state.windDir = fresh.windDir;
    this.state.isAirborne = false;
    this.state.airTime = 0;
    this.state.currentJumpHeight = 0;
    this.state.maxJumpHeightThisAir = 0;
    this.state.inKiteloop = false;
    this.state.kiteloopProgress = 0;
    this.state.waterHeightAtPlayer = 0;
    this.state.waterNormalAtPlayer.set(0, 1, 0);
    this.state.wipeout = false;
    this.state.wipeoutTimer = 0;

    this.kiteloopDir = 1;
    this.kiteloopsThisAir = 0;
    this.jumpHoldTimer = 0;
    this.boardCrouch = 0;
    this.prevWaveLipFlag = false;
    this.kiteRaiseBlend = 0;
    this.kiteAzVel = 0;
    this.kiteElVel = 0;
    this.steerHoldBlend = 0;
    this.headingVel = 0;
    this.pendulumAzVel = 0;
    this.lastLandingReport = null;
  }

  /** Enable or disable beginner-friendly kite auto-stabilization. */
  public setAutoAssist(enabled: boolean): void {
    this.autoAssist = enabled;
  }

  /** Apply equipped kite & board gear bonuses. */
  public setGear(gear: KiteGear | null): void {
    this.gear = gear;
  }

  /** Update wind speed (m/s) and direction (radians, 0 = toward -Z). */
  public setWind(windSpeed: number, windDir = this.state.windDir): void {
    this.baseWindSpeed = windSpeed;
    this.state.windSpeed = windSpeed;
    this.state.windDir = windDir;
  }

  /** Apply an external world impulse (e.g., kicker ramp launch or wind gust thermal). */
  public applyImpulse(impulse: THREE.Vector3): void {
    if (this.state.wipeout) return;

    this.state.velocity.add(impulse);
    this.state.velocity.y = Math.min(this.state.velocity.y, 26);

    const horizSpeed = Math.hypot(this.state.velocity.x, this.state.velocity.z);
    if (horizSpeed > 40) {
      const scale = 40 / horizSpeed;
      this.state.velocity.x *= scale;
      this.state.velocity.z *= scale;
    }

    if (impulse.y > 1.8 && !this.state.isAirborne) {
      this.state.isAirborne = true;
      this.state.airTime = 0;
      this.kiteloopsThisAir = 0;
      this.pendulumAzVel = 0;
      this.state.currentJumpHeight = Math.max(
        0.5,
        this.state.position.y - this.state.waterHeightAtPlayer
      );
      this.state.maxJumpHeightThisAir = this.state.currentJumpHeight;
      this.state.position.y = Math.max(
        this.state.position.y,
        this.state.waterHeightAtPlayer + 0.35
      );
      this.jumpHoldTimer = 0;
    }
  }

  /** Trigger a wipeout externally (e.g., hitting a barrel or shark fin hazard). */
  public triggerWipeout(duration = 1.45): void {
    if (this.state.wipeout) return;
    this.enterWipeout(duration);
  }

  /** Consume the most recent landing report if one occurred since last check. */
  public consumeLandingReport(): LandingReport | null {
    const report = this.lastLandingReport;
    this.lastLandingReport = null;
    return report;
  }

  /** Whether the most recent launch popped off an upward-sloping wave face. */
  public get launchedFromWaveLip(): boolean {
    return this.prevWaveLipFlag;
  }

  /** Return world-space 3D position of the kite canopy. */
  public getKiteWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    computeKiteOffset(
      this.state.windDir,
      this.state.kiteAzimuth,
      this.state.kiteElevation,
      KITE_LINE_LENGTH,
      target
    );
    target.add(this.state.position);
    target.y = Math.max(target.y, this.state.waterHeightAtPlayer + 2.5);
    return target;
  }

  /** Read-only snapshot reference to current PhysicsState. */
  public getState(): PhysicsState {
    return this.state;
  }

  /** Advance kitesurfing physics by dt seconds. */
  public update(
    dt: number,
    input: InputState,
    waveHeightFn: WaveHeightFn,
    time: number,
    options?: PhysicsStepOptions
  ): PhysicsState {
    const clampedDt = Math.min(Math.max(dt, 0.0001), 0.05);
    if (options?.autoAssist !== undefined) {
      this.autoAssist = options.autoAssist;
    }
    if (options?.gear !== undefined) {
      this.gear = options.gear;
    }

    const s = this.state;
    const wave = waveHeightFn(s.position.x, s.position.z, time);
    s.waterHeightAtPlayer = wave.height;
    s.waterNormalAtPlayer.copy(wave.normal).normalize();

    // Subtle organic wind gusts around base wind speed.
    s.windSpeed =
      this.baseWindSpeed +
      Math.sin(time * 0.43) * 1.1 +
      Math.cos(time * 0.19) * 0.6;

    if (s.wipeout) {
      this.stepWipeout(clampedDt, wave.height);
      return s;
    }

    const boostBonus = Math.max(0, this.gear?.boostBonus ?? 0);
    const turnBonus = Math.max(0, this.gear?.turnSpeedBonus ?? 0);
    const hangtimeBonus = Math.max(0, this.gear?.hangtimeBonus ?? 0);

    // 1. Update kite aerodynamics & kiteloop trajectory.
    this.stepKite(clampedDt, input, turnBonus);

    // 2. Apparent wind & line tension calculation.
    const horizSpeed = Math.hypot(s.velocity.x, s.velocity.z);
    const azRad = THREE.MathUtils.degToRad(s.kiteAzimuth);
    const elRad = THREE.MathUtils.degToRad(s.kiteElevation);

    const powerAz = Math.cos(azRad * 0.92);
    const powerEl = Math.cos((elRad - THREE.MathUtils.degToRad(24)) * 0.85);
    const powerZoneFactor = THREE.MathUtils.clamp(powerAz * powerEl, 0.05, 1);

    const dynamicDiveFactor = THREE.MathUtils.clamp(
      Math.abs(s.kiteAngularVel) / 145,
      0,
      0.55
    );

    s.apparentWind =
      s.windSpeed * (0.75 + 0.45 * powerZoneFactor + dynamicDiveFactor) +
      horizSpeed * 0.55;

    const edgeMag = THREE.MathUtils.clamp(
      Math.max(Math.abs(input.edgeAngle), Math.abs(input.kiteSteer) * 0.65),
      0,
      1
    );

    const targetTension = s.inKiteloop
      ? 0.96
      : THREE.MathUtils.clamp(
          0.2 +
            0.34 * input.barTension +
            0.22 * THREE.MathUtils.clamp(horizSpeed / 24, 0, 1) +
            0.24 * edgeMag +
            0.18 * dynamicDiveFactor,
          0.12,
          1.0
        );
    s.lineTension = THREE.MathUtils.lerp(
      s.lineTension,
      targetTension,
      1 - Math.exp(-9 * clampedDt)
    );

    // 3. Step water carving or airborne flight.
    if (!s.isAirborne) {
      this.stepOnWater(
        clampedDt,
        input,
        waveHeightFn,
        time,
        powerZoneFactor,
        dynamicDiveFactor,
        boostBonus,
        turnBonus
      );
    } else {
      this.stepAirborne(
        clampedDt,
        input,
        wave.height,
        powerZoneFactor,
        hangtimeBonus,
        turnBonus
      );
    }

    return s;
  }

  private stepKite(dt: number, input: InputState, turnBonus: number): void {
    const s = this.state;
    const prevAz = s.kiteAzimuth;
    const prevEl = s.kiteElevation;
    const turnScale = 1 + turnBonus * 0.85;

    // Trigger Kiteloop if airborne and requested (Space in mid-air or Shift/E).
    const loopTriggered =
      input.kiteloopRequested || (input.jumpJustPressed && s.airTime > 0.08);
    if (
      loopTriggered &&
      s.isAirborne &&
      !s.inKiteloop &&
      s.currentJumpHeight >= 1.5
    ) {
      s.inKiteloop = true;
      s.kiteloopProgress = 0;
      if (Math.abs(input.kiteSteer) > 0.15) {
        this.kiteloopDir = input.kiteSteer > 0 ? 1 : -1;
      } else {
        this.kiteloopDir = s.kiteAzimuth >= 0 ? 1 : -1;
      }
      this.kiteloopBaseAz = THREE.MathUtils.clamp(s.kiteAzimuth, -72, 72);
      this.kiteloopBaseEl = THREE.MathUtils.clamp(s.kiteElevation, 18, 86);
      this.kiteloopsThisAir += 1;
    }

    if (s.inKiteloop) {
      const loopDuration = 1.38 / (1 + turnBonus * 0.3);
      s.kiteloopProgress += dt / loopDuration;
      const p = Math.min(s.kiteloopProgress, 1);

      // Wide sweeping circular motion in the wind window: dive down power zone, sweep across bottom, climb back up.
      const theta = p * Math.PI * 2;
      const loopRadiusAz = 38;
      const topEl = Math.max(this.kiteloopBaseEl, 58);
      const bottomEl = Math.max(16, topEl - 44);

      s.kiteAzimuth = THREE.MathUtils.clamp(
        this.kiteloopBaseAz * (1 - 0.35 * Math.sin(p * Math.PI)) +
          this.kiteloopDir * Math.sin(theta) * loopRadiusAz,
        MIN_AZIMUTH_DEG,
        MAX_AZIMUTH_DEG
      );
      s.kiteElevation = THREE.MathUtils.clamp(
        THREE.MathUtils.lerp(topEl, bottomEl, (1 - Math.cos(theta)) * 0.5),
        MIN_ELEVATION_DEG,
        MAX_ELEVATION_DEG
      );
      const rollTheta = theta + 1.15 * Math.sin(p * Math.PI);
      s.kiteRoll = this.kiteloopDir * rollTheta;
      s.kiteAngularVel = 360 / loopDuration;

      if (s.kiteloopProgress >= 1) {
        s.inKiteloop = false;
        s.kiteloopProgress = 0;
        s.kiteRoll = 0;
      }
      return;
    }

    // Gradient bar pressure: builds gradually on sustained hold and ramps smoothly across zero.
    if (Math.abs(input.kiteSteer) > 0.05) {
      if (input.kiteSteer * this.steerHoldBlend < 0) {
        const step = 2.2 * dt;
        const diff = input.kiteSteer - this.steerHoldBlend;
        this.steerHoldBlend +=
          Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
      } else {
        this.steerHoldBlend = THREE.MathUtils.lerp(
          this.steerHoldBlend,
          input.kiteSteer,
          1 - Math.exp(-1.85 * dt)
        );
      }
    } else {
      this.steerHoldBlend = THREE.MathUtils.lerp(
        this.steerHoldBlend,
        0,
        1 - Math.exp(-3.4 * dt)
      );
    }

    // Gradual kite steering momentum inside quarter-sphere wind window.
    const maxSteerRate = 64 * (1 + turnBonus * 0.45);
    const effectiveSteer = 0.32 * input.kiteSteer + 0.68 * this.steerHoldBlend;
    let targetAzVel = effectiveSteer * maxSteerRate;
    let targetElVel = 0;

    // Bar sheet-in sends kite higher toward 12 o'clock; sheet-out dives it.
    if (this.autoAssist) {
      if (input.barTension > 0.62) {
        const sheetStrength = (input.barTension - 0.62) / 0.38;
        targetElVel += sheetStrength * 68 * turnScale;
        if (Math.abs(effectiveSteer) < 0.2) {
          targetAzVel += -s.kiteAzimuth * 1.15 * sheetStrength;
        }
      } else if (input.barTension < 0.38) {
        const depowerStrength = (0.38 - input.barTension) / 0.38;
        targetElVel -= depowerStrength * 64 * turnScale;
      }
    } else {
      if (input.barTension > 0.58) {
        const sheetStrength = (input.barTension - 0.58) / 0.42;
        targetElVel += sheetStrength * 68 * turnScale;
        if (Math.abs(effectiveSteer) < 0.25 || effectiveSteer * s.kiteAzimuth < 0) {
          targetAzVel += -s.kiteAzimuth * 0.85 * sheetStrength;
        }
      } else if (input.barTension < 0.38) {
        const depowerStrength = (0.38 - input.barTension) / 0.38;
        targetElVel -= depowerStrength * 64 * turnScale;
      }
    }

    // Gradual turn + lift when steering inward from low side vs outward dive toward 35-40 deg.
    const isSteeringInward = s.kiteAzimuth * effectiveSteer < -2;
    if (isSteeringInward) {
      const inwardLiftVel =
        Math.abs(effectiveSteer) *
        (24 + Math.max(0, 72 - s.kiteElevation) * 0.55);
      targetElVel += inwardLiftVel;
    } else if (
      s.kiteAzimuth * effectiveSteer >= -2 &&
      Math.abs(effectiveSteer) > 0.08
    ) {
      if (!this.autoAssist) {
        if (s.kiteElevation > 37) {
          const outwardDiveVel =
            -Math.abs(effectiveSteer) *
            Math.max(10, (s.kiteElevation - 36) * 0.65);
          targetElVel += outwardDiveVel;
        }
      } else if (!s.isAirborne) {
        targetElVel -= Math.abs(effectiveSteer) * 16;
      }
    }

    // Idle stabilization vs Free-Ride sweet-spot parking.
    const isIdle =
      Math.abs(input.kiteSteer) < 0.08 &&
      Math.abs(input.barTension - 0.5) < 0.16;

    if (isIdle) {
      if (this.autoAssist) {
        const targetEl = s.isAirborne ? 76 : 54;
        targetElVel += (targetEl - s.kiteElevation) * 2.1;
        targetAzVel += -s.kiteAzimuth * 1.4;
      } else {
        if (!s.isAirborne && Math.abs(s.kiteAzimuth) >= 18 && s.kiteElevation <= 56) {
          // Park stably in 37-39 deg sweet spot on side tack (on water)
          targetElVel += (38 - s.kiteElevation) * 1.2;
          targetAzVel = 0;
        } else if (s.kiteElevation > 56) {
          // Hold smoothly near 12 o'clock without centering side tacks
          targetElVel += (76 - s.kiteElevation) * 0.5;
          if (Math.abs(s.kiteAzimuth) < 15) {
            targetAzVel += -s.kiteAzimuth * 0.8;
          }
        }
      }
    } else if (s.isAirborne && this.autoAssist && input.barTension >= 0.42) {
      targetElVel += (74 - s.kiteElevation) * 0.65;
    }

    // Smooth acceleration & deceleration of kite angular velocities.
    this.kiteAzVel = THREE.MathUtils.lerp(
      this.kiteAzVel,
      targetAzVel,
      1 - Math.exp(-3.2 * dt)
    );
    this.kiteElVel = THREE.MathUtils.lerp(
      this.kiteElVel,
      targetElVel,
      1 - Math.exp(-3.5 * dt)
    );

    s.kiteAzimuth = THREE.MathUtils.clamp(
      s.kiteAzimuth + this.kiteAzVel * dt,
      MIN_AZIMUTH_DEG,
      MAX_AZIMUTH_DEG
    );
    s.kiteElevation = THREE.MathUtils.clamp(
      s.kiteElevation + this.kiteElVel * dt,
      MIN_ELEVATION_DEG,
      MAX_ELEVATION_DEG
    );

    // Kite Z-axis roll: rotate bladder edge toward left/right water face when diving away from
    // 12 o'clock, and gradually rotate bladder edge upward back toward 12 o'clock when raising.
    const azNorm = s.kiteAzimuth / MAX_AZIMUTH_DEG;
    const lowFactor =
      1 -
      THREE.MathUtils.clamp(
        (s.kiteElevation - MIN_ELEVATION_DEG) /
          (MAX_ELEVATION_DEG - MIN_ELEVATION_DEG),
        0,
        1
      );
    const diveTilt = THREE.MathUtils.clamp(
      azNorm * (1.25 + 0.75 * lowFactor) + effectiveSteer * 0.48,
      -2.2,
      2.2
    );
    const sheetingUp =
      input.barTension > 0.58 ? (input.barTension - 0.58) / 0.42 : 0;
    const climbingEl =
      this.kiteElVel > 0.05 ? THREE.MathUtils.clamp(this.kiteElVel / 45, 0, 1) : 0;
    const steeringInward = isSteeringInward ? Math.abs(effectiveSteer) : 0;
    const raiseTarget = THREE.MathUtils.clamp(
      Math.max(sheetingUp, steeringInward * 0.9, climbingEl * 0.85),
      0,
      1
    );
    this.kiteRaiseBlend = THREE.MathUtils.lerp(
      this.kiteRaiseBlend,
      raiseTarget,
      1 - Math.exp(-3.8 * dt)
    );
    const upwardTilt = azNorm * 0.28;
    const targetRoll = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(diveTilt, upwardTilt, this.kiteRaiseBlend * 0.82),
      -2.2,
      2.2
    );
    s.kiteRoll = THREE.MathUtils.lerp(s.kiteRoll, targetRoll, 1 - Math.exp(-6.5 * dt));

    const azVel = (s.kiteAzimuth - prevAz) / dt;
    const elVel = (s.kiteElevation - prevEl) / dt;
    const rawAngVel = Math.hypot(azVel, elVel);
    s.kiteAngularVel = THREE.MathUtils.lerp(
      s.kiteAngularVel,
      rawAngVel,
      1 - Math.exp(-12 * dt)
    );
  }

  private stepOnWater(
    dt: number,
    input: InputState,
    waveHeightFn: WaveHeightFn,
    time: number,
    powerZoneFactor: number,
    dynamicDiveFactor: number,
    boostBonus: number,
    turnBonus: number
  ): void {
    const s = this.state;

    // 12 o'clock overhead lull: propulsion only kicks in when kite sits below zenith or dives.
    const elFromZenith = THREE.MathUtils.clamp(
      (84 - s.kiteElevation) / 44,
      0,
      1
    );
    const azSpread = THREE.MathUtils.clamp(Math.abs(s.kiteAzimuth) / 38, 0, 1);
    const windowPullAuthority = THREE.MathUtils.clamp(
      Math.max(elFromZenith * 0.88, azSpread * elFromZenith * 1.1) +
        dynamicDiveFactor * 0.85,
      0.03,
      1.0
    );

    // Rider smoothly follows the kite's pull direction (no abrupt board steering).
    const steerInput = input.kiteSteer;
    if (this.autoAssist) {
      const azTargetHeading = THREE.MathUtils.degToRad(s.kiteAzimuth) * 0.55;
      const targetTurnRate = THREE.MathUtils.clamp(
        (azTargetHeading - s.heading) *
          1.4 *
          (1 + turnBonus * 0.25) *
          (0.2 + 0.8 * windowPullAuthority),
        -0.95,
        0.95
      );
      this.headingVel = THREE.MathUtils.lerp(
        this.headingVel,
        targetTurnRate,
        1 - Math.exp(-3.0 * dt)
      );
      s.heading = THREE.MathUtils.clamp(
        s.heading + this.headingVel * dt,
        -MAX_HEADING_RAD,
        MAX_HEADING_RAD
      );
    } else {
      const maxFreeHeading = THREE.MathUtils.degToRad(94);
      let naturalTackHeading = s.heading;
      if (Math.abs(s.kiteAzimuth) > 8) {
        const sideSign = Math.sign(s.kiteAzimuth);
        const sideReach = THREE.MathUtils.clamp(
          (Math.abs(s.kiteAzimuth) - 8) / 30,
          0,
          1
        );
        const lowPower = THREE.MathUtils.clamp(
          (74 - s.kiteElevation) / 34,
          0.15,
          1
        );
        naturalTackHeading =
          sideSign * THREE.MathUtils.degToRad(86) * sideReach * lowPower;
      } else if (s.kiteElevation <= 70) {
        naturalTackHeading = THREE.MathUtils.degToRad(s.kiteAzimuth) * 0.6;
      }

      const headingErr = normalizeAngleRad(naturalTackHeading - s.heading);
      const desiredTurnRate = THREE.MathUtils.clamp(
        headingErr * 1.15 * (0.15 + 0.85 * windowPullAuthority),
        -0.95,
        0.95
      );
      this.headingVel = THREE.MathUtils.lerp(
        this.headingVel,
        desiredTurnRate,
        1 - Math.exp(-2.8 * dt)
      );
      s.heading = THREE.MathUtils.clamp(
        s.heading + this.headingVel * dt,
        -maxFreeHeading,
        maxFreeHeading
      );
    }

    _tmpForward.set(Math.sin(s.heading), 0, -Math.cos(s.heading));

    // Kite thrust scaled by windowPullAuthority so 12 o'clock stalls and lower window planes fast.
    const sheetPower = 0.55 + 0.52 * input.barTension;
    const sweetSpotDrive =
      !this.autoAssist &&
      s.kiteElevation >= 28 &&
      s.kiteElevation <= 50 &&
      Math.abs(s.kiteAzimuth) >= 22
        ? 0.35
        : 0;
    let kiteDrive =
      1.8 *
      s.windSpeed *
      windowPullAuthority *
      (0.45 +
        0.85 * powerZoneFactor +
        1.05 * dynamicDiveFactor +
        sweetSpotDrive) *
      sheetPower *
      (1 + boostBonus * 0.22);

    // Compute current forward speed along heading.
    let speed = Math.hypot(s.velocity.x, s.velocity.z);

    // Quadratic + linear water resistance + upwind luff drag past 89 deg.
    const edgeIntensity = Math.max(
      Math.abs(input.edgeAngle),
      Math.abs(steerInput) * 0.7
    );
    let dragCoeff = 0.016 + 0.008 * edgeIntensity;
    if (!this.autoAssist) {
      const upwindThreshold = THREE.MathUtils.degToRad(89);
      const absHeading = Math.abs(s.heading);
      if (absHeading > upwindThreshold) {
        const luffFactor = THREE.MathUtils.clamp(
          (absHeading - upwindThreshold) / THREE.MathUtils.degToRad(5),
          0,
          1
        );
        dragCoeff += luffFactor * 0.085;
        kiteDrive *= 1 - 0.65 * luffFactor;
      }
    }
    const accel = kiteDrive - (dragCoeff * speed * speed + 1.15 * speed);
    speed = THREE.MathUtils.clamp(speed + accel * dt, 0.8, 34);

    // Sample wave slope ahead for board pitch & wave-lip detection.
    const aheadSample = waveHeightFn(
      s.position.x + _tmpForward.x * 1.25,
      s.position.z + _tmpForward.z * 1.25,
      time
    );
    const waveSlope = (aheadSample.height - s.waterHeightAtPlayer) / 1.25;

    s.velocity.x = _tmpForward.x * speed;
    s.velocity.z = _tmpForward.z * speed;

    // Move horizontally.
    s.position.x += s.velocity.x * dt;
    s.position.z += s.velocity.z * dt;

    // Re-sample water height at new position so board stays locked cleanly to wave surface.
    const newWave = waveHeightFn(s.position.x, s.position.z, time);
    s.waterHeightAtPlayer = newWave.height;
    s.waterNormalAtPlayer.copy(newWave.normal).normalize();

    const prevY = s.position.y;
    const targetY = newWave.height + 0.06;
    const verticalFollow = THREE.MathUtils.lerp(
      prevY,
      targetY,
      1 - Math.exp(-22 * dt)
    );
    s.position.y = Math.max(targetY - 0.15, verticalFollow);
    s.velocity.y = THREE.MathUtils.clamp((s.position.y - prevY) / dt, -8, 10);

    // Smooth board orientation on water.
    const carveAngle =
      Math.abs(input.edgeAngle) > 0.05 && Math.sign(input.edgeAngle) !== 0
        ? input.edgeAngle
        : steerInput;
    const targetRoll = THREE.MathUtils.clamp(
      carveAngle * 0.56 + (s.kiteAzimuth / 85) * 0.14,
      -0.7,
      0.7
    );
    s.boardRoll = THREE.MathUtils.lerp(s.boardRoll, targetRoll, 1 - Math.exp(-10 * dt));

    const targetPitch = THREE.MathUtils.clamp(
      Math.atan(waveSlope) + 0.08 * s.lineTension,
      -0.45,
      0.55
    );
    s.boardPitch = THREE.MathUtils.lerp(s.boardPitch, targetPitch, 1 - Math.exp(-11 * dt));

    const targetYaw = s.heading + steerInput * 0.14;
    const yawDiff = normalizeAngleRad(targetYaw - s.boardYaw);
    s.boardYaw = normalizeAngleRad(s.boardYaw + yawDiff * (1 - Math.exp(-12 * dt)));

    this.boardCrouch = Math.max(0, this.boardCrouch - dt * 3);

    // Check Big Air Launch!
    if (input.jumpJustPressed) {
      this.launchFromWater(speed, waveSlope, boostBonus);
    }
  }

  private launchFromWater(
    horizSpeed: number,
    waveSlope: number,
    boostBonus: number
  ): void {
    const s = this.state;

    // Zenith alignment factor (12 o'clock send yields massive lift).
    const zenithProximity =
      THREE.MathUtils.clamp(1 - Math.abs(s.kiteElevation - 82) / 56, 0, 1) *
      THREE.MathUtils.clamp(1 - Math.abs(s.kiteAzimuth) / 68, 0, 1);

    const speedNorm = THREE.MathUtils.clamp(horizSpeed / 22, 0.35, 1.25);
    const tensionFactor = 0.45 + 0.55 * s.lineTension;
    const waveLipFactor = THREE.MathUtils.clamp((waveSlope - 0.025) * 4.5, 0, 1);
    this.prevWaveLipFlag = waveLipFactor > 0.18;

    const launchVy =
      9.1 +
      5.2 * speedNorm * tensionFactor +
      3.1 * zenithProximity +
      4.0 * boostBonus +
      2.6 * waveLipFactor;

    // In assisted mode, snap kite toward zenith on jump pop for hangtime.
    if (this.autoAssist) {
      s.kiteElevation = Math.max(s.kiteElevation, 68);
      s.kiteAzimuth *= 0.65;
    }

    s.isAirborne = true;
    s.airTime = 0;
    this.kiteloopsThisAir = 0;
    this.pendulumAzVel = 0;
    s.currentJumpHeight = 0.25;
    s.maxJumpHeightThisAir = 0.25;
    s.position.y = s.waterHeightAtPlayer + 0.25;
    s.velocity.y = launchVy;
    this.jumpHoldTimer = 0.22;
  }

  private stepAirborne(
    dt: number,
    input: InputState,
    waterHeight: number,
    powerZoneFactor: number,
    hangtimeBonus: number,
    turnBonus: number
  ): void {
    const s = this.state;
    s.airTime += dt;

    // Sustained Space hold during first 0.22s grants small extra sheet-in pop.
    if (this.jumpHoldTimer > 0 && input.jumpPressed) {
      s.velocity.y += 4.2 * dt;
      this.jumpHoldTimer -= dt;
    } else {
      this.jumpHoldTimer = 0;
    }

    // Horizontal kite pull in the air.
    computeKiteOffset(s.windDir, s.kiteAzimuth, s.kiteElevation, 1, _tmpKitePullDir);

    if (s.inKiteloop) {
      const p = s.kiteloopProgress;
      const loopDecay = 1 / (1 + Math.max(0, this.kiteloopsThisAir - 1) * 2.5);
      if (p < 0.55) {
        // Phase 1 (diving toward water): temporary forward/lateral pull along lines, normal gravity drop
        const yank = (16.5 + 4.5 * powerZoneFactor) * loopDecay;
        s.velocity.x += _tmpKitePullDir.x * yank * dt;
        s.velocity.z += _tmpKitePullDir.z * yank * dt;
        const diveSupport = 2.4 * _tmpKitePullDir.y * loopDecay;
        s.velocity.y += (diveSupport - GRAVITY) * dt;
      } else {
        // Phase 2 (climbing back up): minimal temporary catch that only cushions fast downward descent
        s.velocity.x += _tmpKitePullDir.x * 6.5 * loopDecay * dt;
        s.velocity.z += _tmpKitePullDir.z * 6.5 * loopDecay * dt;
        const catchSupport =
          (s.velocity.y < -4.0 ? 14.2 : 6.8) *
          (0.35 + 0.65 * _tmpKitePullDir.y) *
          (1 + hangtimeBonus * 0.25) *
          loopDecay;
        s.velocity.y += (catchSupport - GRAVITY) * dt;
      }
    } else {
      // Airborne gravity & pendulum swing underneath the kite fulcrum.
      const azRad = THREE.MathUtils.degToRad(s.kiteAzimuth);
      const elRad = THREE.MathUtils.degToRad(s.kiteElevation);
      const overheadSupport =
        Math.sin(elRad) * Math.pow(Math.max(0.12, Math.cos(azRad)), 0.95);
      const effectiveBar = this.autoAssist
        ? Math.max(input.barTension, 0.52)
        : input.barTension;

      const liftAccel =
        (2.8 + 2.4 * effectiveBar) *
        Math.pow(Math.max(0.15, overheadSupport), 0.8) *
        (1 + hangtimeBonus * 0.65);

      // Horizontal pendulum pull along the kite lines.
      const pendulumHorizPull = (6.5 + 3.5 * s.lineTension) * Math.cos(elRad);
      s.velocity.x += _tmpKitePullDir.x * pendulumHorizPull * dt;
      s.velocity.z += _tmpKitePullDir.z * pendulumHorizPull * dt;

      // Net vertical gravity minus kite overhead lift.
      s.velocity.y += (liftAccel - GRAVITY) * dt;

      // Pendulum restoring swing of kiteAzimuth toward 0 deg as rider swings beneath fulcrum.
      const pendulumRestore =
        -(GRAVITY / KITE_LINE_LENGTH) *
        (180 / Math.PI) *
        Math.sin(azRad) *
        Math.cos(elRad) *
        1.45;
      this.pendulumAzVel += (pendulumRestore - this.pendulumAzVel * 1.25) * dt;
      s.kiteAzimuth = THREE.MathUtils.clamp(
        s.kiteAzimuth + this.pendulumAzVel * dt,
        MIN_AZIMUTH_DEG,
        MAX_AZIMUTH_DEG
      );
      if (Math.abs(s.kiteAzimuth) > 8 && s.kiteElevation < 78) {
        s.kiteElevation = THREE.MathUtils.clamp(
          s.kiteElevation + Math.abs(Math.sin(azRad)) * 14 * dt,
          MIN_ELEVATION_DEG,
          MAX_ELEVATION_DEG
        );
      }
    }

    // Air drag to keep horizontal velocity realistic.
    s.velocity.x *= 1 - 0.14 * dt;
    s.velocity.z *= 1 - 0.14 * dt;

    // Ensure corridor forward momentum in autoAssist, or prevent upwind travel in free ride.
    if (this.autoAssist) {
      if (s.velocity.z > -4) {
        s.velocity.z = THREE.MathUtils.lerp(s.velocity.z, -8, 2 * dt);
      }
    } else if (s.velocity.z > 0.2) {
      s.velocity.z = 0.2;
    }

    // Advance 3D position.
    s.position.addScaledVector(s.velocity, dt);
    const maxAirHeading = this.autoAssist
      ? MAX_HEADING_RAD
      : THREE.MathUtils.degToRad(94);
    s.heading = Math.atan2(s.velocity.x, -s.velocity.z);
    s.heading = THREE.MathUtils.clamp(s.heading, -maxAirHeading, maxAirHeading);

    // Mid-air board trick rotation & pendulum roll from kite fulcrum.
    const trickSpinRate = 6.8 * (1 + turnBonus * 0.35);
    const pendulumRoll =
      THREE.MathUtils.degToRad(s.kiteAzimuth) * 0.36 -
      this.pendulumAzVel * 0.005;
    if (Math.abs(input.trickDir.x) > 0.25) {
      s.boardYaw = normalizeAngleRad(
        s.boardYaw + input.trickDir.x * trickSpinRate * dt
      );
      s.boardRoll = THREE.MathUtils.lerp(
        s.boardRoll,
        input.trickDir.x * 0.42,
        8 * dt
      );
    } else if (this.autoAssist) {
      // Gentle assist brings board toward closest forward or switch alignment when trick released.
      const fwdErr = normalizeAngleRad(s.heading - s.boardYaw);
      const switchErr = normalizeAngleRad(s.heading + Math.PI - s.boardYaw);
      const nearestErr =
        Math.abs(fwdErr) <= Math.abs(switchErr) ? fwdErr : switchErr;
      s.boardYaw = normalizeAngleRad(s.boardYaw + nearestErr * Math.min(1, 5.2 * dt));
      s.boardRoll = THREE.MathUtils.lerp(
        s.boardRoll,
        pendulumRoll + input.kiteSteer * 0.2,
        6 * dt
      );
    } else {
      s.boardRoll = THREE.MathUtils.lerp(
        s.boardRoll,
        pendulumRoll + input.kiteSteer * 0.2,
        6 * dt
      );
    }

    if (Math.abs(input.trickDir.y) > 0.25) {
      s.boardPitch = THREE.MathUtils.lerp(
        s.boardPitch,
        input.trickDir.y * 0.45,
        8 * dt
      );
    } else {
      s.boardPitch = THREE.MathUtils.lerp(
        s.boardPitch,
        THREE.MathUtils.clamp(s.velocity.y * 0.025, -0.35, 0.42),
        6 * dt
      );
    }

    s.currentJumpHeight = Math.max(0, s.position.y - waterHeight);
    s.maxJumpHeightThisAir = Math.max(s.maxJumpHeightThisAir, s.currentJumpHeight);

    // Check water touchdown!
    if (s.position.y <= waterHeight + 0.12 && s.velocity.y < 0) {
      this.handleTouchdown(waterHeight);
    }
  }

  private handleTouchdown(waterHeight: number): void {
    const s = this.state;
    const impactSpeed = -s.velocity.y;
    const hadKiteloop = s.inKiteloop || s.kiteRoll !== 0;

    // Low kiteloop impact while diving through bottom of power zone triggers dramatic wipeout.
    const lowKiteloopWipeout =
      s.inKiteloop &&
      s.kiteloopProgress > 0.15 &&
      s.kiteloopProgress < 0.55 &&
      s.kiteElevation < 28 &&
      impactSpeed > 11.5;

    // Check board alignment with velocity direction (regular OR switch 180 deg counts).
    const fwdErr = Math.abs(normalizeAngleRad(s.boardYaw - s.heading));
    const switchErr = Math.abs(normalizeAngleRad(s.boardYaw - Math.PI - s.heading));
    const minAlignErr = Math.min(fwdErr, switchErr);

    const badAngleWipeout =
      s.maxJumpHeightThisAir > 2.2 &&
      minAlignErr > THREE.MathUtils.degToRad(50);

    const slamWipeout = impactSpeed > 23.5;

    const maxH = s.maxJumpHeightThisAir;
    s.position.y = waterHeight + 0.05;
    s.velocity.y = 0;
    s.isAirborne = false;
    s.currentJumpHeight = 0;

    if (lowKiteloopWipeout || badAngleWipeout || slamWipeout) {
      this.lastLandingReport = {
        clean: false,
        maxHeight: maxH,
        hadKiteloop,
        speedBoost: 0,
      };
      this.enterWipeout(1.45);
      return;
    }

    // Clean landing! Grant speed boost proportional to jump height & kiteloop energy.
    let speedBoost = 0;
    if (maxH >= 1.5) {
      speedBoost = THREE.MathUtils.clamp(2.8 + maxH * 0.14, 2.8, 7.5);
      _tmpForward.set(Math.sin(s.heading), 0, -Math.cos(s.heading));
      s.velocity.addScaledVector(_tmpForward, speedBoost);
      const speed = Math.hypot(s.velocity.x, s.velocity.z);
      if (speed > 36) {
        s.velocity.x *= 36 / speed;
        s.velocity.z *= 36 / speed;
      }
    }

    s.inKiteloop = false;
    s.kiteloopProgress = 0;
    this.kiteloopsThisAir = 0;
    this.pendulumAzVel = 0;
    s.kiteRoll = 0;
    s.boardYaw = s.heading;
    this.boardCrouch = 1;
    this.prevWaveLipFlag = false;

    this.lastLandingReport = {
      clean: true,
      maxHeight: maxH,
      hadKiteloop,
      speedBoost,
    };
  }

  private enterWipeout(duration: number): void {
    const s = this.state;
    s.wipeout = true;
    s.wipeoutTimer = duration;
    s.isAirborne = false;
    s.inKiteloop = false;
    s.kiteloopProgress = 0;
    this.kiteloopsThisAir = 0;
    this.pendulumAzVel = 0;
    s.kiteRoll = 0;
    s.currentJumpHeight = 0;
    s.maxJumpHeightThisAir = 0;
    s.airTime = 0;
    s.velocity.multiplyScalar(0.32);
    s.velocity.y = 0;
    this.prevWaveLipFlag = false;
    this.kiteAzVel = 0;
    this.kiteElVel = 0;
    this.steerHoldBlend = 0;
    this.headingVel = 0;
  }

  private stepWipeout(dt: number, waterHeight: number): void {
    const s = this.state;
    s.wipeoutTimer -= dt;
    s.position.y = THREE.MathUtils.lerp(
      s.position.y,
      waterHeight - 0.12,
      1 - Math.exp(-10 * dt)
    );
    s.velocity.x *= Math.exp(-3.2 * dt);
    s.velocity.z *= Math.exp(-3.2 * dt);
    s.position.x += s.velocity.x * dt;
    s.position.z += s.velocity.z * dt;

    // Stabilize kite gently overhead for quick water-start recovery.
    s.kiteElevation = THREE.MathUtils.lerp(s.kiteElevation, 56, 2.5 * dt);
    s.kiteAzimuth = THREE.MathUtils.lerp(s.kiteAzimuth, 0, 2.5 * dt);
    s.lineTension = THREE.MathUtils.lerp(s.lineTension, 0.25, 4 * dt);
    s.boardRoll = THREE.MathUtils.lerp(s.boardRoll, 0.9, 5 * dt);

    if (s.wipeoutTimer <= 0) {
      s.wipeout = false;
      s.wipeoutTimer = 0;
      s.boardRoll = 0;
      s.boardPitch = 0;
      s.boardYaw = s.heading;
      s.position.y = waterHeight + 0.08;
      _tmpForward.set(Math.sin(s.heading), 0, -Math.cos(s.heading));
      s.velocity.x = _tmpForward.x * 12;
      s.velocity.z = _tmpForward.z * 12;
    }
  }
}
