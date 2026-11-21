import './style.css';
import * as THREE from 'three';
import { AudioEngine } from './audio';
import { GEAR_CATALOG, MISSIONS_CATALOG, SaveManager } from './gear';
import { InputManager } from './input';
import { OceanSystem } from './ocean';
import { ParticleSystem } from './particles';
import { KitePhysicsEngine, normalizeAngleRad } from './physics';
import { RiderAndKiteRig } from './rider';
import { TrickSystem } from './tricks';
import type { GameMode, GameState, InputState, ObstacleItem, RunSummary } from './types';
import { UIManager } from './ui';
import { WorldManager } from './world';

type CameraPreset = 'CHASE' | 'POV' | 'PRO' | 'HELI';

const CAMERA_PRESETS: readonly CameraPreset[] = ['CHASE', 'POV', 'PRO', 'HELI'];
const HEAT_DURATION_SECONDS = 90;

const MODE_WIND_SPEED: Record<GameMode, number> = {
  BIG_AIR: 17.5,
  FREESTYLE: 15.5,
  SLALOM: 16.0,
  ENDLESS: 15.0,
};

const _leftWingtip = new THREE.Vector3();
const _rightWingtip = new THREE.Vector3();
const _boardLeft = new THREE.Vector3();
const _boardRight = new THREE.Vector3();
const _boardTail = new THREE.Vector3();
const _kiteWorldPos = new THREE.Vector3();
const _camDesiredPos = new THREE.Vector3();
const _camDesiredLook = new THREE.Vector3();
const _camCurrentLook = new THREE.Vector3();

function createDemoInput(
  time: number,
  playerPos?: THREE.Vector3,
  obstacles?: readonly ObstacleItem[]
): InputState {
  let carve = Math.sin(time * 0.65) * 0.55;

  if (playerPos && obstacles && obstacles.length > 0) {
    let avoidSteer = 0;
    let closestDz = 28;
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (!obs.active || obs.passed) continue;
      if (
        obs.type === 'FLOATING_BARREL' ||
        obs.type === 'SHARK_FIN' ||
        obs.type === 'BUOY_LEFT' ||
        obs.type === 'BUOY_RIGHT'
      ) {
        const dz = playerPos.z - obs.position.z;
        if (dz > 0 && dz < closestDz) {
          const dx = playerPos.x - obs.position.x;
          const safeWidth = obs.radius + 3.6;
          if (Math.abs(dx) < safeWidth) {
            closestDz = dz;
            avoidSteer = dx >= 0 ? 0.85 : -0.85;
          }
        }
      }
    }
    if (avoidSteer !== 0) {
      carve = avoidSteer;
    }
  }

  return {
    kiteSteer: carve,
    barTension: 0.38 + 0.15 * Math.sin(time * 0.9),
    edgeAngle: carve * 0.85,
    jumpPressed: false,
    jumpJustPressed: false,
    trickDir: { x: 0, y: 0 },
    kiteloopRequested: false,
    pauseJustPressed: false,
  };
}

class KiteRushGame {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;

  private readonly saveManager: SaveManager;
  private readonly ocean: OceanSystem;
  private readonly particles: ParticleSystem;
  private readonly physics: KitePhysicsEngine;
  private readonly rider: RiderAndKiteRig;
  private readonly tricks: TrickSystem;
  private readonly world: WorldManager;
  private readonly audio: AudioEngine;
  private readonly input: InputManager;
  private readonly ui: UIManager;

  private gameState: GameState = 'MENU';
  private shopReturnState: GameState = 'MENU';
  private currentMode: GameMode = 'BIG_AIR';
  private cameraPresetIndex = 0;

  private simTime = 0;
  private runElapsed = 0;
  private heatTimeRemaining = HEAT_DURATION_SECONDS;
  private bonusWorldScore = 0;
  private runCoins = 0;
  private startZ = 0;
  private totalDistanceRun = 0;
  private maxJumpHeightRun = 0;
  private maxComboMultRun = 1;
  private ringsPassedRun = 0;
  private gatesClearedRun = 0;
  private landedMegaKiteloopRun = false;
  private runSummary: RunSummary | null = null;

  private cameraShake = 0;
  private cameraInitialized = false;
  private lastFrameMs = 0;
  private rafId = 0;
  private disposed = false;

  constructor() {
    this.container = document.getElementById('app') ?? document.body;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x7ccae5, 0.00045);

    this.camera = new THREE.PerspectiveCamera(
      66,
      Math.max(1, window.innerWidth) / Math.max(1, window.innerHeight),
      0.25,
      2400
    );

    this.saveManager = new SaveManager();
    this.ocean = new OceanSystem(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.particles.setWaveHeightFn(this.ocean.waveHeightFn);

    this.physics = new KitePhysicsEngine(MODE_WIND_SPEED.BIG_AIR);
    const equippedGear = this.saveManager.getEquippedGear();
    this.physics.setGear(equippedGear);

    this.rider = new RiderAndKiteRig(this.scene, equippedGear);
    this.tricks = new TrickSystem();
    this.world = new WorldManager(this.scene);
    this.world.reset(this.currentMode, 0, 0);

    this.audio = new AudioEngine({ muted: false, musicEnabled: false });
    this.input = new InputManager(this.container);
    this.input.setGameplayActive(false);

    this.ui = new UIManager(
      {
        onStartGame: (mode) => this.startRun(mode),
        onPauseToggle: () => this.togglePause(),
        onRestart: () => this.startRun(this.currentMode),
        onMainMenu: () => this.returnToMenu(),
        onOpenShop: () => this.openShop(),
        onCloseShop: () => this.closeShop(),
        onEquipGear: (gearId) => this.handleEquipGear(gearId),
        onUnlockGear: (gearId) => this.handleUnlockGear(gearId),
        onToggleAudio: (muted) => this.audio.setMuted(muted),
        onToggleMusic: (enabled) => {
          this.audio.unlock();
          this.audio.setMusicEnabled(enabled);
        },
        onToggleAutoAssist: (enabled) => {
          this.input.setAutoAssist(enabled);
          this.physics.setAutoAssist(enabled);
        },
        onToggleCamera: () => this.cycleCameraPreset(),
      },
      {
        container: this.container,
        gearCatalog: GEAR_CATALOG,
        missions: MISSIONS_CATALOG,
        initialMode: this.currentMode,
        audioMuted: this.audio.isMuted(),
        musicEnabled: this.audio.isMusicEnabled(),
        autoAssist: this.input.isAutoAssist(),
        cameraLabel: this.getCameraLabel(),
      }
    );

    window.addEventListener('resize', this.handleResize, { passive: true });
    window.addEventListener('keydown', this.handleGlobalKeyDown);

    // Initialize initial rider, ocean, and camera pose for immediate crisp first frame
    const demoInput = createDemoInput(0);
    const pState = this.physics.update(1 / 60, demoInput, this.ocean.waveHeightFn, 0, {
      autoAssist: true,
      gear: equippedGear,
    });
    this.rider.update(pState, 0, this.tricks.getVisualState());
    this.ocean.update(0, pState.position, pState.windDir, pState.windSpeed, 1 / 60);
    this.world.animatePreview(1 / 60, pState.position, this.ocean.waveHeightFn, 0);
    this.updateCamera(1 / 60, true);

    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private getCameraLabel(): CameraPreset {
    return CAMERA_PRESETS[this.cameraPresetIndex];
  }

  private cycleCameraPreset(): void {
    const prevPreset = this.getCameraLabel();
    this.cameraPresetIndex = (this.cameraPresetIndex + 1) % CAMERA_PRESETS.length;
    const nextPreset = this.getCameraLabel();
    if (prevPreset === 'POV' || nextPreset === 'POV') {
      this.cameraInitialized = false;
    }
    this.ui.setToggleStates({ cameraLabel: nextPreset });
  }

  private startRun(mode: GameMode): void {
    this.audio.unlock();
    this.currentMode = mode;
    this.gameState = 'PLAYING';
    this.input.setGameplayActive(true);

    const equippedGear = this.saveManager.getEquippedGear();
    this.physics.reset(MODE_WIND_SPEED[mode]);
    this.physics.setGear(equippedGear);
    this.physics.setAutoAssist(this.input.isAutoAssist());

    this.rider.applyGear(equippedGear);
    this.tricks.reset();
    this.particles.reset();
    this.world.reset(mode, 0, 0);

    this.runElapsed = 0;
    this.heatTimeRemaining = HEAT_DURATION_SECONDS;
    this.bonusWorldScore = 0;
    this.runCoins = 0;
    this.startZ = this.physics.state.position.z;
    this.totalDistanceRun = 0;
    this.maxJumpHeightRun = 0;
    this.maxComboMultRun = 1;
    this.ringsPassedRun = 0;
    this.gatesClearedRun = 0;
    this.landedMegaKiteloopRun = false;
    this.runSummary = null;
    this.cameraShake = 0;
    this.cameraInitialized = false;

    const pState = this.physics.update(1 / 60, createDemoInput(0), this.ocean.waveHeightFn, this.simTime, {
      autoAssist: this.input.isAutoAssist(),
      gear: equippedGear,
    });
    this.rider.update(pState, this.simTime, this.tricks.getVisualState());
    this.ocean.update(this.simTime, pState.position, pState.windDir, pState.windSpeed, 1 / 60);
    this.updateCamera(1 / 60, true);
    this.ui.resetRunUI();
  }

  private togglePause(): void {
    if (this.gameState === 'PLAYING') {
      this.gameState = 'PAUSED';
      this.input.setGameplayActive(false);
    } else if (this.gameState === 'PAUSED') {
      this.audio.unlock();
      this.gameState = 'PLAYING';
      this.input.setGameplayActive(true);
    }
  }

  private persistCurrentEndlessIfActive(): void {
    if (
      this.currentMode === 'ENDLESS' &&
      (this.gameState === 'PLAYING' || this.gameState === 'PAUSED')
    ) {
      const score = this.tricks.getScore() + this.bonusWorldScore;
      if (score > 0 || this.maxJumpHeightRun > 0) {
        this.saveManager.recordRun({
          mode: 'ENDLESS',
          score,
          maxJumpHeight: this.maxJumpHeightRun,
        });
      }
    }
  }

  private returnToMenu(): void {
    this.persistCurrentEndlessIfActive();
    this.gameState = 'MENU';
    this.input.setGameplayActive(false);

    const equippedGear = this.saveManager.getEquippedGear();
    this.physics.reset(MODE_WIND_SPEED[this.currentMode]);
    this.physics.setGear(equippedGear);
    this.rider.applyGear(equippedGear);
    this.tricks.reset();
    this.particles.reset();
    this.world.reset(this.currentMode, 0, 0);
    this.totalDistanceRun = 0;
    this.runSummary = null;
    this.cameraShake = 0;
    this.cameraInitialized = false;
  }

  private openShop(): void {
    if (this.gameState !== 'SHOP') {
      this.shopReturnState = this.gameState;
      this.gameState = 'SHOP';
      this.input.setGameplayActive(false);
    }
  }

  private closeShop(): void {
    if (this.gameState === 'SHOP') {
      this.gameState = this.shopReturnState;
      this.input.setGameplayActive(this.gameState === 'PLAYING');
    }
  }

  private handleEquipGear(gearId: string): void {
    if (this.saveManager.equipGear(gearId)) {
      const gear = this.saveManager.getEquippedGear();
      this.rider.applyGear(gear);
      this.physics.setGear(gear);
      this.audio.playTrickChime(2);
    }
  }

  private handleUnlockGear(gearId: string): void {
    if (this.saveManager.unlockGear(gearId)) {
      const gear = this.saveManager.getEquippedGear();
      this.rider.applyGear(gear);
      this.physics.setGear(gear);
      this.audio.playRingPass();
      this.ui.showCallout('GEAR UNLOCKED!', `${gear.name.toUpperCase()} EQUIPPED`, 'record');
    }
  }

  private finishRun(): void {
    const finalScore = this.tricks.getScore() + this.bonusWorldScore;
    const { isNewBest } = this.saveManager.recordRun({
      mode: this.currentMode,
      score: finalScore,
      maxJumpHeight: this.maxJumpHeightRun,
    });

    this.evaluateAndNotifyMissions();

    const distance = Math.max(
      this.totalDistanceRun,
      this.startZ - this.physics.state.position.z
    );
    const bestComboPts = this.tricks.getBestCombo();
    this.runSummary = {
      mode: this.currentMode,
      score: finalScore,
      isNewBest,
      maxJumpHeight: this.maxJumpHeightRun,
      bestCombo: bestComboPts >= 20 ? bestComboPts : this.maxComboMultRun,
      distance,
      coinsEarned: this.runCoins,
      tricksLanded: this.tricks.getTricksLanded(),
    };

    this.gameState = 'GAME_OVER';
    this.input.setGameplayActive(false);
    this.audio.playRingPass();
  }

  private evaluateAndNotifyMissions(): void {
    const newlyCompleted = this.saveManager.evaluateMissions({
      maxJumpHeight: this.maxJumpHeightRun,
      landedMegaKiteloop: this.landedMegaKiteloopRun,
      coinsEarnedThisRun: this.runCoins,
      ringsPassedThisRun: this.ringsPassedRun,
      bestCombo: this.maxComboMultRun,
      gatesClearedThisRun: this.gatesClearedRun,
    });

    for (const mission of newlyCompleted) {
      this.ui.showCallout(
        'MISSION COMPLETE!',
        `${mission.title} (+${mission.rewardCoins} COINS)`,
        'record'
      );
      this.audio.playRingPass();
    }
  }

  private handleGlobalKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'KeyC' && !e.repeat && this.gameState === 'PLAYING') {
      this.cycleCameraPreset();
    }
  };

  private handleResize = (): void => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  };

  private tick = (nowMs: number): void => {
    if (this.disposed) return;

    const rawDt = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    const dt = THREE.MathUtils.clamp(rawDt, 0.001, 0.05);

    const inputState = this.input.update(dt);

    if (inputState.pauseJustPressed) {
      if (this.gameState === 'PLAYING' || this.gameState === 'PAUSED') {
        this.togglePause();
      }
    }

    let frameTricks = [] as ReturnType<TrickSystem['update']>;
    let worldEvents = [] as ReturnType<WorldManager['update']>;

    if (this.gameState === 'PLAYING') {
      const equippedGear = this.saveManager.getEquippedGear();
      this.simTime += dt;
      this.runElapsed += dt;
      if (this.currentMode !== 'ENDLESS') {
        this.heatTimeRemaining -= dt;
      }

      const wasAirborne = this.physics.state.isAirborne;
      const prevVelY = this.physics.state.velocity.y;
      const prevInKiteloop = this.physics.state.inKiteloop;
      const wasWipeout = this.physics.state.wipeout;

      const pState = this.physics.update(dt, inputState, this.ocean.waveHeightFn, this.simTime, {
        autoAssist: this.input.isAutoAssist(),
        gear: equippedGear,
      });
      this.totalDistanceRun += Math.hypot(pState.velocity.x, pState.velocity.z) * dt;

      if (!wasAirborne && pState.isAirborne && pState.velocity.y > 5.0) {
        this.audio.playJumpPop();
      }
      if (!prevInKiteloop && pState.inKiteloop) {
        this.audio.playKiteloop();
        this.cameraShake = Math.max(this.cameraShake, 0.34);
      }

      const landing = this.physics.consumeLandingReport();
      if (landing) {
        this.audio.playLanding(landing.clean);
        if (landing.clean) {
          if (landing.hadKiteloop && landing.maxHeight >= 9.5) {
            this.landedMegaKiteloopRun = true;
          }
          this.cameraShake = Math.max(
            this.cameraShake,
            Math.min(0.45, 0.14 + landing.maxHeight * 0.01)
          );
          this.particles.emitLandingSplash(
            pState.position,
            Math.max(8, Math.abs(prevVelY)),
            true
          );
        } else {
          this.audio.playWipeout();
          this.cameraShake = Math.max(this.cameraShake, 0.65);
          this.particles.emitLandingSplash(
            pState.position,
            Math.max(12, Math.abs(prevVelY)),
            false
          );
        }
      } else if (!wasWipeout && pState.wipeout) {
        this.audio.playWipeout();
        this.cameraShake = Math.max(this.cameraShake, 0.6);
      }

      frameTricks = this.tricks.update(
        dt,
        pState,
        inputState,
        this.physics.launchedFromWaveLip
      );

      if (frameTricks.length > 0) {
        const comboCount = this.tricks.getStatus().comboCount;
        for (const trick of frameTricks) {
          if (trick.points > 0 && trick.style !== 'LANDING') {
            this.audio.playTrickChime(comboCount);
            break;
          }
        }
      }

      worldEvents = this.world.update(
        dt,
        pState,
        this.currentMode,
        this.ocean.waveHeightFn,
        this.simTime
      );

      for (const ev of worldEvents) {
        if (ev.coins > 0) {
          this.runCoins += ev.coins;
          this.saveManager.addCoins(ev.coins);
        }

        switch (ev.type) {
          case 'COIN_PICKUP':
            this.bonusWorldScore += ev.points;
            this.audio.playCoinPickup();
            break;
          case 'RAMP_BOOST':
            if (ev.impulse) this.physics.applyImpulse(ev.impulse);
            this.tricks.addWorldBonus(ev.label ?? 'KICKER LAUNCH', ev.points, 1, 'COMBO');
            this.audio.playRampBoost();
            this.particles.emitJumpPop(pState.position, 1.35);
            this.cameraShake = Math.max(this.cameraShake, 0.28);
            break;
          case 'RING_PASS':
            if (ev.impulse) this.physics.applyImpulse(ev.impulse);
            this.ringsPassedRun += 1;
            this.tricks.addWorldBonus('SKY RING', ev.points, 2, 'COMBO');
            this.audio.playRingPass();
            this.cameraShake = Math.max(this.cameraShake, 0.22);
            break;
          case 'GATE_CLEAR':
            if (ev.impulse) this.physics.applyImpulse(ev.impulse);
            this.gatesClearedRun += 1;
            this.tricks.addWorldBonus('SLALOM GATE', ev.points, 1, 'COMBO');
            this.audio.playTrickChime(this.tricks.getStatus().comboCount);
            break;
          case 'GUST_LIFT':
            if (ev.impulse) this.physics.applyImpulse(ev.impulse);
            this.tricks.addWorldBonus('THERMAL GUST', ev.points, 1, 'COMBO');
            this.audio.playRingPass();
            break;
          case 'HAZARD_HIT':
            this.physics.triggerWipeout(1.45);
            this.particles.emitWipeoutSplash(pState.position);
            this.audio.playWipeout();
            this.cameraShake = Math.max(this.cameraShake, 0.72);
            break;
        }
      }

      this.maxJumpHeightRun = Math.max(this.maxJumpHeightRun, pState.maxJumpHeightThisAir);
      const trickStatus = this.tricks.getStatus();
      this.maxComboMultRun = Math.max(this.maxComboMultRun, trickStatus.multiplier);
      this.evaluateAndNotifyMissions();

      this.rider.update(pState, this.simTime, this.tricks.getVisualState());
      this.ocean.update(this.simTime, pState.position, pState.windDir, pState.windSpeed, dt);
      this.syncParticles(dt, equippedGear.kiteColorPrimary);
      this.updateCamera(dt, false);

      if (this.currentMode !== 'ENDLESS' && this.heatTimeRemaining <= 0) {
        if (!pState.isAirborne || this.heatTimeRemaining <= -4.5) {
          this.finishRun();
        }
      }
    } else if (
      this.gameState === 'MENU' ||
      (this.gameState === 'SHOP' && this.shopReturnState === 'MENU')
    ) {
      if (this.gameState === 'MENU') {
        this.currentMode = this.ui.getSelectedMode();
      }
      const equippedGear = this.saveManager.getEquippedGear();
      this.simTime += dt;
      const demoInput = createDemoInput(
        this.simTime,
        this.physics.state.position,
        this.world.getActiveObstacles()
      );
      const pState = this.physics.update(
        dt,
        demoInput,
        this.ocean.waveHeightFn,
        this.simTime,
        { autoAssist: true, gear: equippedGear }
      );
      const demoEvents = this.world.update(
        dt,
        pState,
        this.currentMode,
        this.ocean.waveHeightFn,
        this.simTime
      );
      for (const ev of demoEvents) {
        if ((ev.type === 'RAMP_BOOST' || ev.type === 'GUST_LIFT') && ev.impulse) {
          this.physics.applyImpulse(ev.impulse);
        }
      }
      this.rider.update(pState, this.simTime, this.tricks.getVisualState());
      this.ocean.update(this.simTime, pState.position, pState.windDir, pState.windSpeed, dt);
      this.syncParticles(dt, equippedGear.kiteColorPrimary);
      this.updateCamera(dt, false);
    } else {
      // PAUSED, GAME_OVER, or SHOP opened from GAME_OVER: keep camera steady without advancing physics
      this.updateCamera(dt, false);
    }

    const isPovActive =
      this.getCameraLabel() === 'POV' &&
      this.gameState !== 'MENU' &&
      !(this.gameState === 'SHOP' && this.shopReturnState === 'MENU');
    this.rider.setFirstPersonMode(isPovActive);

    this.audio.update(dt, this.physics.state, this.gameState);

    const trickStatus = this.tricks.getStatus();
    const totalScore = trickStatus.score + this.bonusWorldScore;
    const distance = Math.max(
      this.totalDistanceRun,
      this.startZ - this.physics.state.position.z
    );
    const activeTrickLabel =
      trickStatus.activeTricks.length > 0
        ? trickStatus.activeTricks.join(' + ')
        : trickStatus.styleRating;

    this.ui.update({
      dt,
      gameState: this.gameState,
      mode: this.currentMode,
      physics: this.physics.state,
      saveData: this.saveManager.getData(),
      score: totalScore,
      comboMultiplier: trickStatus.multiplier,
      comboTimer: trickStatus.comboTimer,
      comboMaxTime: trickStatus.comboMaxTime,
      comboPoints: trickStatus.comboPoints,
      distance,
      runCoins: this.runCoins,
      timeRemaining:
        this.currentMode === 'ENDLESS' ? undefined : Math.max(0, this.heatTimeRemaining),
      elapsedTime: this.runElapsed,
      audioMuted: this.audio.isMuted(),
      musicEnabled: this.audio.isMusicEnabled(),
      autoAssist: this.input.isAutoAssist(),
      cameraLabel: this.getCameraLabel(),
      runSummary: this.runSummary,
      newTricks: frameTricks,
      newWorldEvents: worldEvents,
      activeTrickLabel,
    });

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private syncParticles(dt: number, ribbonColor: string): void {
    this.rider.getLeftWingtipWorldPosition(_leftWingtip);
    this.rider.getRightWingtipWorldPosition(_rightWingtip);
    this.rider.getBoardSprayPositions(_boardLeft, _boardRight);
    this.rider.getBoardTailWorldPosition(_boardTail);

    this.particles.update(dt, this.physics.state, this.simTime, {
      leftWingtip: _leftWingtip,
      rightWingtip: _rightWingtip,
      boardLeftPos: _boardLeft,
      boardRightPos: _boardRight,
      boardTailPos: _boardTail,
      waveHeightFn: this.ocean.waveHeightFn,
      ribbonColor,
    });
  }

  private updateCamera(dt: number, snap: boolean): void {
    const s = this.physics.state;
    this.physics.getKiteWorldPosition(_kiteWorldPos);
    const isMenuCamera =
      this.gameState === 'MENU' ||
      (this.gameState === 'SHOP' && this.shopReturnState === 'MENU');
    const preset = this.getCameraLabel();
    const isPov = !isMenuCamera && preset === 'POV';

    if (isMenuCamera) {
      const orbitAngle = Math.sin(this.simTime * 0.2) * 0.72 + 0.52;
      const radius = 33.0;
      _camDesiredPos.set(
        s.position.x + Math.sin(orbitAngle) * radius,
        s.position.y + 7.6 + Math.sin(this.simTime * 0.35) * 0.45,
        s.position.z + Math.cos(orbitAngle) * radius
      );
      _camDesiredLook.set(s.position.x, s.position.y + 4.2, s.position.z - 4.0);

      const waveAtCam = this.ocean.waveHeightFn(
        _camDesiredPos.x,
        _camDesiredPos.z,
        this.simTime
      );
      _camDesiredPos.y = Math.max(_camDesiredPos.y, waveAtCam.height + 2.4);

      const targetFov = 72;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-5 * dt));
      this.camera.updateProjectionMatrix();
    } else if (isPov) {
      const speed = Math.hypot(s.velocity.x, s.velocity.z);
      const speedFactor = THREE.MathUtils.clamp((speed - 12) / 22, 0, 1);
      const airFactor = THREE.MathUtils.clamp(s.currentJumpHeight / 28, 0, 1);

      const fwdX = Math.sin(s.heading);
      const fwdZ = -Math.cos(s.heading);
      const rightX = Math.cos(s.heading);
      const rightZ = Math.sin(s.heading);

      const povBack = -0.42;
      const povHeight = 1.52 - Math.abs(s.boardRoll) * 0.08;
      const lateralLean = -Math.sin(s.boardRoll) * 0.22;

      _camDesiredPos.set(
        s.position.x + fwdX * povBack + rightX * lateralLean,
        s.position.y + povHeight,
        s.position.z + fwdZ * povBack + rightZ * lateralLean
      );

      const waveAtCam = this.ocean.waveHeightFn(
        _camDesiredPos.x,
        _camDesiredPos.z,
        this.simTime
      );
      _camDesiredPos.y = Math.max(_camDesiredPos.y, waveAtCam.height + 0.9);

      const kiteHeightAboveRider = Math.max(0, _kiteWorldPos.y - s.position.y);
      _camDesiredLook.set(
        THREE.MathUtils.lerp(s.position.x + fwdX * 18, _kiteWorldPos.x, 0.22),
        s.position.y + 3.2 + kiteHeightAboveRider * 0.08,
        THREE.MathUtils.lerp(s.position.z + fwdZ * 18, _kiteWorldPos.z, 0.22)
      );

      const targetFov = 92 + speedFactor * 3.5 + airFactor * 2.5;
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-7 * dt));
      this.camera.updateProjectionMatrix();
    } else {
      const speed = Math.hypot(s.velocity.x, s.velocity.z);
      const speedFactor = THREE.MathUtils.clamp((speed - 12) / 22, 0, 1);
      const airFactor = THREE.MathUtils.clamp(s.currentJumpHeight / 28, 0, 1);
      const kiteElFactor = THREE.MathUtils.clamp((s.kiteElevation - 40) / 48, 0, 1);

      const kiteWorldAz = s.windDir + THREE.MathUtils.degToRad(s.kiteAzimuth);
      const camHeading = this.input.isAutoAssist()
        ? s.heading
        : s.heading + normalizeAngleRad(kiteWorldAz - s.heading) * 0.32;
      const camFwdX = Math.sin(camHeading);
      const camFwdZ = -Math.cos(camHeading);
      const camRightX = Math.cos(camHeading);
      const camRightZ = Math.sin(camHeading);

      let dist = 27.5 + kiteElFactor * 3.5 + airFactor * 5.5 + speedFactor * 1.4;
      let camHeight = 6.6 + airFactor * 1.5;
      let sideOffset = 0;
      let baseFov = 74;
      let lookHeight = 8.4 + kiteElFactor * 1.2;

      if (preset === 'PRO') {
        dist = 20.5 + kiteElFactor * 3.0 + airFactor * 4.5;
        camHeight = 4.6 + airFactor * 1.2;
        baseFov = 78;
        lookHeight = 7.2 + kiteElFactor * 1.4;
      } else if (preset === 'HELI') {
        dist = 28.5 + airFactor * 6.0;
        camHeight = 9.5 + airFactor * 2.5;
        sideOffset = 8.5;
        baseFov = 66;
        lookHeight = 8.2;
      }

      _camDesiredPos.set(
        s.position.x - camFwdX * dist + camRightX * sideOffset,
        s.position.y + camHeight,
        s.position.z - camFwdZ * dist + camRightZ * sideOffset
      );

      const waveAtCam = this.ocean.waveHeightFn(
        _camDesiredPos.x,
        _camDesiredPos.z,
        this.simTime
      );
      _camDesiredPos.y = Math.max(_camDesiredPos.y, waveAtCam.height + 2.0);

      _camDesiredLook.set(
        THREE.MathUtils.lerp(s.position.x + camFwdX * 4.5, _kiteWorldPos.x, 0.2),
        s.position.y + lookHeight,
        THREE.MathUtils.lerp(s.position.z + camFwdZ * 4.5, _kiteWorldPos.z, 0.18)
      );

      const targetFov = baseFov + speedFactor * 6.5 + airFactor * 6.5 + (s.inKiteloop ? 3.0 : 0);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-7 * dt));
      this.camera.updateProjectionMatrix();
    }

    if (snap || !this.cameraInitialized) {
      this.camera.position.copy(_camDesiredPos);
      _camCurrentLook.copy(_camDesiredLook);
      this.cameraInitialized = true;
    } else {
      const posBlend = isPov ? 1 - Math.exp(-24 * dt) : 1 - Math.exp(-8.5 * dt);
      const lookBlend = isPov ? 1 - Math.exp(-18 * dt) : 1 - Math.exp(-11.0 * dt);
      this.camera.position.lerp(_camDesiredPos, posBlend);
      _camCurrentLook.lerp(_camDesiredLook, lookBlend);
    }

    if (this.cameraShake > 0.002) {
      const shakeMag = this.cameraShake * (isPov ? 0.22 : 0.45);
      this.camera.position.x += (Math.random() - 0.5) * shakeMag;
      this.camera.position.y += (Math.random() - 0.5) * shakeMag;
      this.camera.position.z += (Math.random() - 0.5) * shakeMag * 0.5;
      this.cameraShake *= Math.exp(-9.5 * dt);
    } else {
      this.cameraShake = 0;
    }

    this.camera.lookAt(_camCurrentLook);
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleGlobalKeyDown);
    this.ui.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.world.dispose();
    this.particles.dispose();
    this.ocean.dispose();
    this.renderer.dispose();
  }
}

const game = new KiteRushGame();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game.dispose();
  });
}
