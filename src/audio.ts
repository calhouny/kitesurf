import type { GameState, PhysicsState } from './types';

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

interface NoiseBurstOpts {
  duration: number;
  filterType: BiquadFilterType;
  startFreq: number;
  endFreq: number;
  q?: number;
  peakGain: number;
  attack?: number;
  startOffset?: number;
  useWhiteNoise?: boolean;
  pan?: number;
}

interface ToneOpts {
  type: OscillatorType;
  startFreq: number;
  endFreq: number;
  duration: number;
  peakGain: number;
  attack?: number;
  startOffset?: number;
  filterFreq?: number;
  pan?: number;
  bus?: GainNode;
}

const PENTATONIC_RATIOS = [
  1,
  9 / 8,
  5 / 4,
  3 / 2,
  5 / 3,
  2,
  9 / 4,
  5 / 2,
  3,
  10 / 3,
  4,
];

interface ChordStep {
  bassHz: number;
  arpHz: number[];
  padHz: number[];
}

// Upbeat tropical progression in C major / A minor (Fmaj7 -> G6 -> Em7 -> Am7)
const MUSIC_PROGRESSION: ChordStep[] = [
  {
    bassHz: 87.31, // F2
    arpHz: [349.23, 440.0, 523.25, 659.25, 523.25, 440.0],
    padHz: [261.63, 329.63, 440.0],
  },
  {
    bassHz: 98.0, // G2
    arpHz: [392.0, 493.88, 587.33, 659.25, 587.33, 493.88],
    padHz: [246.94, 329.63, 392.0],
  },
  {
    bassHz: 82.41, // E2
    arpHz: [329.63, 392.0, 493.88, 587.33, 493.88, 392.0],
    padHz: [246.94, 293.66, 392.0],
  },
  {
    bassHz: 110.0, // A2
    arpHz: [440.0, 523.25, 659.25, 783.99, 659.25, 523.25],
    padHz: [261.63, 329.63, 392.0],
  },
];

const ARP_STEP_MAP: Record<number, number> = {
  0: 0,
  3: 1,
  6: 2,
  8: 3,
  10: 4,
  14: 5,
};

/**
 * 100% procedural Web Audio API sound engine for Kite Rush: Big Air.
 * Handles continuous wind, water carving, silent-air transitions, ocean waves,
 * synthesized arcade SFX, and an optional procedural tropical synthwave groove.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private pinkNoiseBuffer: AudioBuffer | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;

  // Continuous layer nodes
  private windBaseFilter: BiquadFilterNode | null = null;
  private windBaseGain: GainNode | null = null;
  private windWhooshFilter: BiquadFilterNode | null = null;
  private windWhooshGain: GainNode | null = null;

  private carveLowpass: BiquadFilterNode | null = null;
  private carveGain: GainNode | null = null;

  private waveGain: GainNode | null = null;

  private continuousSources: AudioScheduledSourceNode[] = [];

  private muted = false;
  private musicEnabled = false;
  private graphReady = false;
  private disposed = false;

  // Music lookahead scheduler state
  private musicTimerId: number | null = null;
  private nextStepTime = 0;
  private currentStep = 0;
  private readonly stepDuration = 60 / 118 / 4; // 118 BPM 16th notes

  private readonly boundUnlockHandler = (): void => {
    this.unlock();
  };

  constructor(options?: { muted?: boolean; musicEnabled?: boolean }) {
    this.muted = options?.muted ?? false;
    this.musicEnabled = options?.musicEnabled ?? false;

    if (typeof window !== 'undefined') {
      const opts: AddEventListenerOptions = { passive: true, capture: true };
      window.addEventListener('pointerdown', this.boundUnlockHandler, opts);
      window.addEventListener('touchstart', this.boundUnlockHandler, opts);
      window.addEventListener('keydown', this.boundUnlockHandler, opts);
      window.addEventListener('click', this.boundUnlockHandler, opts);
    }
  }

  /**
   * Unlocks / initializes Web Audio safely on first user gesture.
   */
  public unlock(): void {
    if (this.disposed || typeof window === 'undefined') return;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      try {
        this.ctx = new AudioCtx();
      } catch {
        return;
      }
    }

    if (!this.graphReady) {
      this.initGraph();
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().then(() => {
        if (this.musicEnabled && !this.disposed) {
          this.startMusicScheduler();
        }
      }).catch(() => {
        // Ignore browser autoplay rejection until next gesture
      });
    } else if (this.musicEnabled && this.musicTimerId === null) {
      this.startMusicScheduler();
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 1, now, 0.03);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) {
      this.unlock();
    }
    if (this.ctx && this.musicBus) {
      const now = this.ctx.currentTime;
      this.musicBus.gain.setTargetAtTime(enabled ? 0.24 : 0, now, 0.08);
    }
    if (enabled && this.ctx) {
      this.startMusicScheduler();
    } else if (!enabled) {
      this.stopMusicScheduler();
    }
  }

  public isMusicEnabled(): boolean {
    return this.musicEnabled;
  }

  public toggleMusic(): boolean {
    this.setMusicEnabled(!this.musicEnabled);
    return this.musicEnabled;
  }

  /**
   * Modulates continuous rushing wind, water carving spray, silent-air transition,
   * and ocean ambience each frame using live PhysicsState.
   */
  public update(
    _dt: number,
    physics: PhysicsState,
    gameState: GameState = 'PLAYING'
  ): void {
    if (
      this.musicEnabled &&
      this.ctx &&
      this.musicTimerId === null &&
      !this.disposed
    ) {
      this.startMusicScheduler();
    }

    if (
      this.disposed ||
      !this.ctx ||
      !this.graphReady ||
      this.ctx.state !== 'running'
    ) {
      return;
    }

    const now = this.ctx.currentTime;
    const isPlaying = gameState === 'PLAYING';
    const isPaused = gameState === 'PAUSED';

    // Apparent wind & kite angular velocity (handle both deg/s and rad/s scales cleanly)
    const windSpeed = Math.max(0, physics.apparentWind);
    const windNorm = clamp((windSpeed - 3) / 28, 0, 1);
    const rawAngVel = Math.abs(physics.kiteAngularVel);
    // kiteAngularVel is in deg/s (typical dive ~100-150 deg/s, kiteloop ~340 deg/s)
    const angVelNorm = clamp(rawAngVel / 150, 0, 1);

    // 1. Rushing wind + kite dive whoosh
    if (this.windBaseFilter && this.windBaseGain) {
      const baseFreq = isPlaying
        ? 280 + windNorm * 1950 + (physics.isAirborne ? 320 : 0)
        : 360;
      const baseGain = isPaused
        ? 0.025
        : isPlaying
          ? (0.045 + windNorm * 0.155) * (physics.isAirborne ? 0.72 : 1.0)
          : 0.055;

      this.windBaseFilter.frequency.setTargetAtTime(baseFreq, now, 0.08);
      this.windBaseGain.gain.setTargetAtTime(baseGain, now, 0.08);
    }

    if (this.windWhooshFilter && this.windWhooshGain) {
      const whooshFreq = 340 + angVelNorm * 1150 + windNorm * 420;
      const whooshGain = isPlaying
        ? angVelNorm * (0.04 + windNorm * 0.17)
        : 0;
      this.windWhooshFilter.frequency.setTargetAtTime(whooshFreq, now, 0.045);
      this.windWhooshGain.gain.setTargetAtTime(whooshGain, now, 0.045);
    }

    // 2. Water carving hull hiss — dramatically silences when airborne!
    if (this.carveLowpass && this.carveGain) {
      const horizontalSpeed = Math.hypot(
        physics.velocity.x,
        physics.velocity.z
      );
      const speedNorm = clamp((horizontalSpeed - 1.5) / 24, 0, 1);
      const tensionNorm = clamp(physics.lineTension, 0, 1);
      const carveIntensity = clamp(
        0.35 + Math.abs(physics.boardRoll) * 1.1 + tensionNorm * 0.65,
        0.3,
        1.25
      );

      if (isPlaying && !physics.isAirborne && !physics.wipeout) {
        const targetCarveGain = clamp(
          speedNorm * (0.06 + tensionNorm * 0.14) * carveIntensity,
          0,
          0.25
        );
        const targetCutoff = 1600 + speedNorm * 3200 + tensionNorm * 1400;
        this.carveGain.gain.setTargetAtTime(targetCarveGain, now, 0.06);
        this.carveLowpass.frequency.setTargetAtTime(targetCutoff, now, 0.06);
      } else {
        // Breathtaking silent-air mute when airborne or paused
        this.carveGain.gain.setTargetAtTime(0, now, 0.04);
      }
    }

    // 3. Ocean wave ambience (attenuates high in Big Air)
    if (this.waveGain) {
      const heightAtten = physics.isAirborne
        ? 1 / (1 + Math.max(0, physics.currentJumpHeight) * 0.14)
        : 1;
      const targetWaveGain = isPaused
        ? 0.03
        : 0.075 * heightAtten;
      this.waveGain.gain.setTargetAtTime(targetWaveGain, now, 0.12);
    }

    // 4. Subtle music ducking on pause or wipeout
    if (this.musicBus) {
      const targetMusicGain = !this.musicEnabled
        ? 0
        : isPaused
          ? 0.16
          : physics.wipeout
            ? 0.14
            : 0.24;
      this.musicBus.gain.setTargetAtTime(targetMusicGain, now, 0.14);
    }
  }

  public playJumpPop(): void {
    if (!this.canPlaySfx()) return;
    // Crisp board release pop
    this.playTone({
      type: 'triangle',
      startFreq: 195,
      endFreq: 68,
      duration: 0.14,
      peakGain: 0.32,
      attack: 0.004,
    });
    // Water tail spray burst
    this.playNoiseBurst({
      duration: 0.18,
      filterType: 'bandpass',
      startFreq: 1300,
      endFreq: 3600,
      q: 1.4,
      peakGain: 0.24,
      attack: 0.008,
      useWhiteNoise: true,
    });
    // Upward air lift whoosh
    this.playNoiseBurst({
      duration: 0.28,
      filterType: 'bandpass',
      startFreq: 380,
      endFreq: 1550,
      q: 2.0,
      peakGain: 0.16,
      attack: 0.02,
      startOffset: 0.03,
    });
  }

  public playKiteloop(): void {
    if (!this.canPlaySfx()) return;
    // Turbine wingtip whoosh sweeping through the power zone
    this.playNoiseBurst({
      duration: 0.42,
      filterType: 'bandpass',
      startFreq: 320,
      endFreq: 1900,
      q: 3.4,
      peakGain: 0.3,
      attack: 0.04,
    });
    this.playNoiseBurst({
      duration: 0.38,
      filterType: 'bandpass',
      startFreq: 1850,
      endFreq: 480,
      q: 2.8,
      peakGain: 0.22,
      attack: 0.03,
      startOffset: 0.26,
    });
    // Low power-zone yank surge
    this.playTone({
      type: 'sawtooth',
      startFreq: 90,
      endFreq: 155,
      duration: 0.34,
      peakGain: 0.16,
      attack: 0.03,
      filterFreq: 420,
    });
    this.playTone({
      type: 'sine',
      startFreq: 150,
      endFreq: 75,
      duration: 0.28,
      peakGain: 0.2,
      attack: 0.02,
      startOffset: 0.28,
    });
  }

  public playLanding(clean: boolean): void {
    if (!this.canPlaySfx()) return;
    if (clean) {
      // Tight planing water skid + crisp spray
      this.playTone({
        type: 'sine',
        startFreq: 125,
        endFreq: 52,
        duration: 0.16,
        peakGain: 0.28,
        attack: 0.004,
      });
      this.playNoiseBurst({
        duration: 0.22,
        filterType: 'bandpass',
        startFreq: 2600,
        endFreq: 1200,
        q: 1.2,
        peakGain: 0.24,
        attack: 0.005,
        useWhiteNoise: true,
      });
      // Speed boost sparkle fifth
      this.playTone({
        type: 'triangle',
        startFreq: 523.25,
        endFreq: 523.25,
        duration: 0.14,
        peakGain: 0.11,
        attack: 0.006,
      });
      this.playTone({
        type: 'triangle',
        startFreq: 783.99,
        endFreq: 783.99,
        duration: 0.2,
        peakGain: 0.12,
        attack: 0.006,
        startOffset: 0.06,
      });
    } else {
      // Heavy sketchy landing slap
      this.playTone({
        type: 'sine',
        startFreq: 145,
        endFreq: 40,
        duration: 0.24,
        peakGain: 0.34,
        attack: 0.004,
      });
      this.playNoiseBurst({
        duration: 0.34,
        filterType: 'lowpass',
        startFreq: 2200,
        endFreq: 520,
        q: 0.9,
        peakGain: 0.28,
        attack: 0.006,
        useWhiteNoise: true,
      });
    }
  }

  public playWipeout(): void {
    if (!this.canPlaySfx()) return;
    // Heavy body/board crash thud
    this.playTone({
      type: 'sine',
      startFreq: 115,
      endFreq: 30,
      duration: 0.3,
      peakGain: 0.42,
      attack: 0.004,
    });
    // Wide turbulent splash crash
    this.playNoiseBurst({
      duration: 0.72,
      filterType: 'lowpass',
      startFreq: 3400,
      endFreq: 340,
      q: 0.8,
      peakGain: 0.38,
      attack: 0.006,
      useWhiteNoise: true,
    });
    // Frothy bubble tail
    this.playNoiseBurst({
      duration: 0.5,
      filterType: 'bandpass',
      startFreq: 950,
      endFreq: 420,
      q: 2.2,
      peakGain: 0.16,
      attack: 0.04,
      startOffset: 0.14,
    });
    // Momentum power-down drop
    this.playTone({
      type: 'sawtooth',
      startFreq: 250,
      endFreq: 72,
      duration: 0.36,
      peakGain: 0.14,
      attack: 0.01,
      filterFreq: 750,
    });
  }

  public playTrickChime(comboCount: number): void {
    if (!this.canPlaySfx()) return;
    const idx = clamp(Math.max(1, Math.round(comboCount)) - 1, 0, PENTATONIC_RATIOS.length - 1);
    const baseFreq = 440 * PENTATONIC_RATIOS[idx];

    this.playTone({
      type: 'sine',
      startFreq: baseFreq,
      endFreq: baseFreq * 1.005,
      duration: 0.26,
      peakGain: 0.18,
      attack: 0.006,
      pan: -0.15,
    });
    this.playTone({
      type: 'triangle',
      startFreq: baseFreq * 1.5,
      endFreq: baseFreq * 1.5,
      duration: 0.22,
      peakGain: 0.09,
      attack: 0.008,
      startOffset: 0.035,
      pan: 0.2,
    });
  }

  public playCoinPickup(): void {
    if (!this.canPlaySfx()) return;
    this.playTone({
      type: 'sine',
      startFreq: 987.77, // B5
      endFreq: 987.77,
      duration: 0.09,
      peakGain: 0.16,
      attack: 0.004,
    });
    this.playTone({
      type: 'sine',
      startFreq: 1318.51, // E6
      endFreq: 1318.51,
      duration: 0.18,
      peakGain: 0.18,
      attack: 0.004,
      startOffset: 0.055,
    });
  }

  public playRingPass(): void {
    if (!this.canPlaySfx()) return;
    // Ethereal sky-ring chord arpeggio + airy shimmer
    const notes = [392.0, 493.88, 587.33, 739.99]; // Gmaj7 shimmer
    notes.forEach((freq, i) => {
      this.playTone({
        type: 'triangle',
        startFreq: freq,
        endFreq: freq,
        duration: 0.28,
        peakGain: 0.13,
        attack: 0.008,
        startOffset: i * 0.04,
        pan: (i - 1.5) * 0.25,
      });
    });
    this.playNoiseBurst({
      duration: 0.3,
      filterType: 'bandpass',
      startFreq: 900,
      endFreq: 2800,
      q: 2.5,
      peakGain: 0.14,
      attack: 0.02,
    });
  }

  public playRampBoost(): void {
    if (!this.canPlaySfx()) return;
    // Fiberglass ramp thwack
    this.playTone({
      type: 'triangle',
      startFreq: 150,
      endFreq: 85,
      duration: 0.1,
      peakGain: 0.26,
      attack: 0.003,
    });
    // Rising turbo boost synth + wind sweep
    this.playTone({
      type: 'sawtooth',
      startFreq: 210,
      endFreq: 740,
      duration: 0.28,
      peakGain: 0.14,
      attack: 0.012,
      filterFreq: 2200,
    });
    this.playNoiseBurst({
      duration: 0.32,
      filterType: 'bandpass',
      startFreq: 450,
      endFreq: 2600,
      q: 2.0,
      peakGain: 0.2,
      attack: 0.015,
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMusicScheduler();

    if (typeof window !== 'undefined') {
      const opts: EventListenerOptions = { capture: true };
      window.removeEventListener('pointerdown', this.boundUnlockHandler, opts);
      window.removeEventListener('touchstart', this.boundUnlockHandler, opts);
      window.removeEventListener('keydown', this.boundUnlockHandler, opts);
      window.removeEventListener('click', this.boundUnlockHandler, opts);
    }

    for (const src of this.continuousSources) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore already-stopped source
      }
    }
    this.continuousSources = [];

    if (this.ctx) {
      void this.ctx.close().catch(() => {
        // Ignore close errors
      });
      this.ctx = null;
    }
    this.graphReady = false;
  }

  private canPlaySfx(): boolean {
    return (
      !this.disposed &&
      !this.muted &&
      this.ctx !== null &&
      this.graphReady &&
      this.ctx.state === 'running'
    );
  }

  private initGraph(): void {
    if (!this.ctx || this.graphReady) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Master limiter + gain
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, now);
    compressor.knee.setValueAtTime(12, now);
    compressor.ratio.setValueAtTime(4, now);
    compressor.attack.setValueAtTime(0.004, now);
    compressor.release.setValueAtTime(0.15, now);

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.muted ? 0 : 1, now);

    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.setValueAtTime(0.9, now);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.setValueAtTime(1.0, now);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.setValueAtTime(this.musicEnabled ? 0.24 : 0, now);

    this.ambienceBus.connect(this.masterGain);
    this.sfxBus.connect(this.masterGain);
    this.masterGain.connect(compressor);
    // Music connects independently of masterGain so music plays even if SFX/ambience are muted
    this.musicBus.connect(compressor);
    compressor.connect(ctx.destination);

    this.pinkNoiseBuffer = this.buildNoiseBuffer(ctx, 4.0, true);
    this.whiteNoiseBuffer = this.buildNoiseBuffer(ctx, 3.0, false);

    // Layer 1a: Base wind rush
    const windBaseSrc = ctx.createBufferSource();
    windBaseSrc.buffer = this.pinkNoiseBuffer;
    windBaseSrc.loop = true;

    this.windBaseFilter = ctx.createBiquadFilter();
    this.windBaseFilter.type = 'lowpass';
    this.windBaseFilter.frequency.setValueAtTime(360, now);
    this.windBaseFilter.Q.setValueAtTime(0.85, now);

    this.windBaseGain = ctx.createGain();
    this.windBaseGain.gain.setValueAtTime(0.04, now);

    windBaseSrc.connect(this.windBaseFilter);
    this.windBaseFilter.connect(this.windBaseGain);
    this.windBaseGain.connect(this.ambienceBus);
    windBaseSrc.start(now);
    this.continuousSources.push(windBaseSrc);

    // Layer 1b: Dynamic kite dive whoosh
    const windWhooshSrc = ctx.createBufferSource();
    windWhooshSrc.buffer = this.pinkNoiseBuffer;
    windWhooshSrc.loop = true;
    windWhooshSrc.playbackRate.setValueAtTime(1.07, now);

    this.windWhooshFilter = ctx.createBiquadFilter();
    this.windWhooshFilter.type = 'bandpass';
    this.windWhooshFilter.frequency.setValueAtTime(420, now);
    this.windWhooshFilter.Q.setValueAtTime(2.4, now);

    this.windWhooshGain = ctx.createGain();
    this.windWhooshGain.gain.setValueAtTime(0, now);

    windWhooshSrc.connect(this.windWhooshFilter);
    this.windWhooshFilter.connect(this.windWhooshGain);
    this.windWhooshGain.connect(this.ambienceBus);
    windWhooshSrc.start(now);
    this.continuousSources.push(windWhooshSrc);

    // Layer 2: Crisp water carving hull hiss
    const carveSrc = ctx.createBufferSource();
    carveSrc.buffer = this.whiteNoiseBuffer;
    carveSrc.loop = true;

    const carveHighpass = ctx.createBiquadFilter();
    carveHighpass.type = 'highpass';
    carveHighpass.frequency.setValueAtTime(950, now);

    this.carveLowpass = ctx.createBiquadFilter();
    this.carveLowpass.type = 'lowpass';
    this.carveLowpass.frequency.setValueAtTime(2400, now);
    this.carveLowpass.Q.setValueAtTime(1.0, now);

    this.carveGain = ctx.createGain();
    this.carveGain.gain.setValueAtTime(0, now);

    carveSrc.connect(carveHighpass);
    carveHighpass.connect(this.carveLowpass);
    this.carveLowpass.connect(this.carveGain);
    this.carveGain.connect(this.ambienceBus);
    carveSrc.start(now);
    this.continuousSources.push(carveSrc);

    // Layer 3: Subtle rolling ocean wave ambience with organic dual LFO swell
    const waveSrc = ctx.createBufferSource();
    waveSrc.buffer = this.pinkNoiseBuffer;
    waveSrc.loop = true;
    waveSrc.playbackRate.setValueAtTime(0.86, now);

    const waveFilter = ctx.createBiquadFilter();
    waveFilter.type = 'lowpass';
    waveFilter.frequency.setValueAtTime(260, now);
    waveFilter.Q.setValueAtTime(0.7, now);

    this.waveGain = ctx.createGain();
    this.waveGain.gain.setValueAtTime(0.065, now);

    const lfo1 = ctx.createOscillator();
    lfo1.type = 'sine';
    lfo1.frequency.setValueAtTime(0.13, now);
    const lfo1Depth = ctx.createGain();
    lfo1Depth.gain.setValueAtTime(115, now);
    lfo1.connect(lfo1Depth);
    lfo1Depth.connect(waveFilter.frequency);

    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.setValueAtTime(0.21, now);
    const lfo2Depth = ctx.createGain();
    lfo2Depth.gain.setValueAtTime(55, now);
    lfo2.connect(lfo2Depth);
    lfo2Depth.connect(waveFilter.frequency);

    waveSrc.connect(waveFilter);
    waveFilter.connect(this.waveGain);
    this.waveGain.connect(this.ambienceBus);

    waveSrc.start(now);
    lfo1.start(now);
    lfo2.start(now);
    this.continuousSources.push(waveSrc, lfo1, lfo2);

    this.graphReady = true;
  }

  private buildNoiseBuffer(
    ctx: AudioContext,
    seconds: number,
    pink: boolean
  ): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const crossfadeSamples = Math.min(2048, Math.floor(length * 0.05));

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        if (pink) {
          b0 = 0.99886 * b0 + white * 0.0555179;
          b1 = 0.99332 * b1 + white * 0.0750759;
          b2 = 0.96900 * b2 + white * 0.1538520;
          b3 = 0.86650 * b3 + white * 0.3104856;
          b4 = 0.55000 * b4 + white * 0.5329522;
          b5 = -0.7616 * b5 - white * 0.0168980;
          const out = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
          b6 = white * 0.115926;
          data[i] = clamp(out * 0.11, -1, 1);
        } else {
          data[i] = white * 0.45;
        }
      }

      // Seamless loop boundary crossfade
      for (let i = 0; i < crossfadeSamples; i++) {
        const t = i / crossfadeSamples;
        const tailIdx = length - crossfadeSamples + i;
        const blended = data[tailIdx] * (1 - t) + data[i] * t;
        data[tailIdx] = blended;
      }
    }

    return buffer;
  }

  private playNoiseBurst(opts: NoiseBurstOpts): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + (opts.startOffset ?? 0);
    const attack = opts.attack ?? 0.01;
    const end = start + opts.duration;

    const src = ctx.createBufferSource();
    src.buffer = opts.useWhiteNoise
      ? this.whiteNoiseBuffer
      : this.pinkNoiseBuffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.Q.setValueAtTime(opts.q ?? 1.2, start);
    filter.frequency.setValueAtTime(Math.max(20, opts.startFreq), start);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(20, opts.endFreq),
      end
    );

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(opts.peakGain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    src.connect(filter);
    filter.connect(gain);

    if (opts.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(opts.pan, -1, 1), start);
      gain.connect(panner);
      panner.connect(this.sfxBus);
    } else {
      gain.connect(this.sfxBus);
    }

    const offset = Math.random() * 1.5;
    src.start(start, offset);
    src.stop(end + 0.02);
  }

  private playTone(opts: ToneOpts): void {
    if (!this.ctx || !this.sfxBus) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + (opts.startOffset ?? 0);
    const attack = opts.attack ?? 0.005;
    const end = start + opts.duration;

    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(Math.max(20, opts.startFreq), start);
    if (opts.endFreq !== opts.startFreq) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, opts.endFreq),
        end
      );
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(opts.peakGain, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    let tail: AudioNode = osc;
    if (opts.filterFreq !== undefined) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(opts.filterFreq, start);
      tail.connect(lp);
      tail = lp;
    }

    tail.connect(gain);
    const targetBus = opts.bus ?? this.sfxBus;

    if (opts.pan !== undefined && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(opts.pan, -1, 1), start);
      gain.connect(panner);
      panner.connect(targetBus);
    } else {
      gain.connect(targetBus);
    }

    osc.start(start);
    osc.stop(end + 0.02);
  }

  private startMusicScheduler(): void {
    if (this.disposed || !this.ctx || this.musicTimerId !== null) return;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.musicTimerId = window.setInterval(() => {
      this.scheduleMusicAhead();
    }, 75);
    if (this.ctx.state === 'running') {
      this.scheduleMusicAhead();
    }
  }

  private stopMusicScheduler(): void {
    if (this.musicTimerId !== null) {
      window.clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }
  }

  private scheduleMusicAhead(): void {
    if (
      !this.musicEnabled ||
      this.disposed ||
      !this.ctx ||
      !this.musicBus
    ) {
      return;
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        // Wait for next gesture if autoplay blocked
      });
      return;
    }
    if (this.ctx.state !== 'running') {
      return;
    }

    const lookahead = 0.18;
    if (this.nextStepTime < this.ctx.currentTime - 0.25) {
      this.nextStepTime = this.ctx.currentTime + 0.04;
    }

    while (this.nextStepTime < this.ctx.currentTime + lookahead) {
      this.scheduleMusicStep(this.currentStep, this.nextStepTime);
      this.nextStepTime += this.stepDuration;
      this.currentStep = (this.currentStep + 1) % 64;
    }
  }

  private scheduleMusicStep(step: number, time: number): void {
    if (!this.ctx || !this.musicBus) return;
    const ctx = this.ctx;
    const barIdx = Math.floor(step / 16) % MUSIC_PROGRESSION.length;
    const barStep = step % 16;
    const chord = MUSIC_PROGRESSION[barIdx];

    // 1. Warm pad swell on downbeat of each bar
    if (barStep === 0) {
      for (const freq of chord.padHz) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(850, time);
        const g = ctx.createGain();
        const dur = this.stepDuration * 15.5;
        g.gain.setValueAtTime(0.0001, time);
        g.gain.linearRampToValueAtTime(0.09, time + 0.28);
        g.gain.setValueAtTime(0.08, time + dur - 0.35);
        g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
        osc.connect(lp);
        lp.connect(g);
        g.connect(this.musicBus);
        osc.start(time);
        osc.stop(time + dur + 0.02);
      }
    }

    // 2. Driving synthwave 8th-note bass
    if (barStep % 2 === 0) {
      const isOffbeat = barStep % 4 === 2;
      const bassFreq = isOffbeat ? chord.bassHz * 2 : chord.bassHz;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(bassFreq, time);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(190, time);
      filter.frequency.exponentialRampToValueAtTime(760, time + 0.03);
      filter.frequency.exponentialRampToValueAtTime(220, time + 0.21);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(isOffbeat ? 0.22 : 0.28, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

      osc.connect(filter);
      filter.connect(g);
      g.connect(this.musicBus);
      osc.start(time);
      osc.stop(time + 0.24);
    }

    // 3. Syncopated tropical marimba pluck
    const arpIdx = ARP_STEP_MAP[barStep];
    if (arpIdx !== undefined) {
      const freq = chord.arpHz[arpIdx % chord.arpHz.length];
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      const harmonic = ctx.createOscillator();
      harmonic.type = 'triangle';
      harmonic.frequency.setValueAtTime(freq * 2, time);

      const hGain = ctx.createGain();
      hGain.gain.setValueAtTime(0.0001, time);
      hGain.gain.linearRampToValueAtTime(0.06, time + 0.006);
      hGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.18, time + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);

      osc.connect(g);
      harmonic.connect(hGain);
      hGain.connect(g);

      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.setValueAtTime(((arpIdx % 3) - 1) * 0.28, time);
        g.connect(panner);
        panner.connect(this.musicBus);
      } else {
        g.connect(this.musicBus);
      }

      osc.start(time);
      harmonic.start(time);
      osc.stop(time + 0.24);
      harmonic.stop(time + 0.24);
    }

    // 4. Light 4-on-the-floor kick & offbeat hi-hat
    if (barStep % 4 === 0) {
      const kick = ctx.createOscillator();
      kick.type = 'sine';
      kick.frequency.setValueAtTime(115, time);
      kick.frequency.exponentialRampToValueAtTime(46, time + 0.09);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.32, time + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);

      kick.connect(g);
      g.connect(this.musicBus);
      kick.start(time);
      kick.stop(time + 0.16);
    }

    if (barStep % 4 === 2 && this.whiteNoiseBuffer) {
      const hat = ctx.createBufferSource();
      hat.buffer = this.whiteNoiseBuffer;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(6500, time);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(0.08, time + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
      hat.connect(hp);
      hp.connect(g);
      g.connect(this.musicBus);
      hat.start(time, Math.random());
      hat.stop(time + 0.06);
    }
  }
}
