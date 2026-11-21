import * as THREE from 'three';

export type GameState = 'MENU' | 'PLAYING' | 'PAUSED' | 'GAME_OVER' | 'SHOP';

export type GameMode = 'ENDLESS' | 'BIG_AIR' | 'FREESTYLE' | 'SLALOM';

export interface InputState {
  kiteSteer: number;
  barTension: number;
  edgeAngle: number;
  jumpPressed: boolean;
  jumpJustPressed: boolean;
  trickDir: { x: number; y: number };
  kiteloopRequested: boolean;
  pauseJustPressed: boolean;
}

export interface PhysicsState {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  heading: number;
  boardPitch: number;
  boardRoll: number;
  boardYaw: number;
  kiteAzimuth: number;
  kiteElevation: number;
  kiteRoll: number;
  kiteAngularVel: number;
  lineTension: number;
  apparentWind: number;
  windSpeed: number;
  windDir: number;
  isAirborne: boolean;
  airTime: number;
  currentJumpHeight: number;
  maxJumpHeightThisAir: number;
  inKiteloop: boolean;
  kiteloopProgress: number;
  waterHeightAtPlayer: number;
  waterNormalAtPlayer: THREE.Vector3;
  wipeout: boolean;
  wipeoutTimer: number;
}

export type TrickStyle = 'GRAB' | 'ROTATION' | 'KITELOOP' | 'COMBO' | 'LANDING';

export interface TrickEvent {
  name: string;
  points: number;
  multiplierDelta: number;
  style: TrickStyle;
}

export type ObstacleType =
  | 'RAMP'
  | 'BUOY_LEFT'
  | 'BUOY_RIGHT'
  | 'RING'
  | 'FLOATING_BARREL'
  | 'SHARK_FIN'
  | 'WIND_GUST';

export interface ObstacleItem {
  id: number;
  type: ObstacleType;
  position: THREE.Vector3;
  radius: number;
  active: boolean;
  passed: boolean;
}

export interface KiteGear {
  id: string;
  name: string;
  description?: string;
  kiteColorPrimary: string;
  kiteColorSecondary: string;
  boardColor: string;
  boostBonus: number;
  turnSpeedBonus: number;
  hangtimeBonus: number;
  cost: number;
}

export interface PlayerSaveData {
  highScores: Record<GameMode, number>;
  maxHeightRecord: number;
  coins: number;
  unlockedGear: string[];
  equippedGear: string;
  completedMissions: string[];
}

export interface WaveSample {
  height: number;
  normal: THREE.Vector3;
}

export type WaveHeightFn = (x: number, z: number, time: number) => WaveSample;

export interface MissionDef {
  id: string;
  title: string;
  description: string;
  rewardCoins: number;
}

export type WorldEventType =
  | 'RAMP_BOOST'
  | 'RING_PASS'
  | 'COIN_PICKUP'
  | 'GATE_CLEAR'
  | 'GUST_LIFT'
  | 'HAZARD_HIT';

export interface WorldEvent {
  type: WorldEventType;
  position: THREE.Vector3;
  points: number;
  coins: number;
  impulse?: THREE.Vector3;
  label?: string;
}

export interface RunSummary {
  mode: GameMode;
  score: number;
  isNewBest: boolean;
  maxJumpHeight: number;
  bestCombo: number;
  distance: number;
  coinsEarned: number;
  tricksLanded: number;
}
