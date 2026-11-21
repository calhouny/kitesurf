import { GEAR_CATALOG, MISSIONS_CATALOG } from './gear';
import {
  GameMode,
  GameState,
  KiteGear,
  MissionDef,
  PhysicsState,
  PlayerSaveData,
  RunSummary,
  TrickEvent,
  TrickStyle,
  WorldEvent,
} from './types';

export type CalloutVariant = 'trick' | 'landing' | 'wipeout' | 'record' | 'boost' | 'warning';

export interface UICallbacks {
  onStartGame: (mode: GameMode) => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onOpenShop?: () => void;
  onCloseShop?: () => void;
  onEquipGear: (gearId: string) => void;
  onUnlockGear: (gearId: string) => void;
  onToggleAudio: (muted: boolean) => void;
  onToggleMusic: (enabled: boolean) => void;
  onToggleAutoAssist: (enabled: boolean) => void;
  onToggleCamera: () => void;
}

export interface UIManagerOptions {
  container?: HTMLElement;
  gearCatalog?: KiteGear[];
  missions?: MissionDef[];
  initialMode?: GameMode;
  audioMuted?: boolean;
  musicEnabled?: boolean;
  autoAssist?: boolean;
  cameraLabel?: string;
}

export interface UIUpdateData {
  dt: number;
  gameState: GameState;
  mode: GameMode;
  physics: PhysicsState;
  saveData: PlayerSaveData;
  score: number;
  comboMultiplier: number;
  comboTimer: number;
  comboMaxTime?: number;
  comboPoints?: number;
  distance: number;
  runCoins: number;
  timeRemaining?: number;
  elapsedTime?: number;
  speedKnots?: number;
  audioMuted?: boolean;
  musicEnabled?: boolean;
  autoAssist?: boolean;
  cameraLabel?: string;
  runSummary?: RunSummary | null;
  newTricks?: TrickEvent[];
  newWorldEvents?: WorldEvent[];
  activeTrickLabel?: string;
  gearCatalog?: KiteGear[];
  missions?: MissionDef[];
}

interface ModeMeta {
  id: GameMode;
  title: string;
  badge: string;
  durationLabel: string;
  description: string;
}

const MODE_DEFINITIONS: ModeMeta[] = [
  {
    id: 'BIG_AIR',
    title: 'King of the Air',
    badge: '90s HEAT',
    durationLabel: '01:30',
    description: 'Send 12 o’clock zenith boosts, thread sky-rings, and pull mega kiteloops.',
  },
  {
    id: 'ENDLESS',
    title: 'Endless Ocean',
    badge: 'FREE RIDE',
    durationLabel: 'OPEN',
    description: 'Ride infinite tropical swells, hit kicker ramps, dodge hazards, stack coins.',
  },
  {
    id: 'FREESTYLE',
    title: 'Freestyle Jam',
    badge: '90s JAM',
    durationLabel: '01:30',
    description: 'Link grabs, rolls, and late loops cleanly to climb up to a 10x multiplier.',
  },
  {
    id: 'SLALOM',
    title: 'Slalom Course',
    badge: '90s RACE',
    durationLabel: '01:30',
    description: 'Carve at full speed between alternating red & green buoy gates for chain bonuses.',
  },
];

const MODE_MAP: Record<GameMode, ModeMeta> = {
  BIG_AIR: MODE_DEFINITIONS[0],
  ENDLESS: MODE_DEFINITIONS[1],
  FREESTYLE: MODE_DEFINITIONS[2],
  SLALOM: MODE_DEFINITIONS[3],
};

const STYLE_ID = 'kr-ui-styles';
const ROOT_ID = 'kr-ui-root';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed) || /^rgba?\([^)]+\)$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function formatScore(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function formatMeters(value: number): string {
  return `${Math.max(0, Math.round(value)).toLocaleString('en-US')}m`;
}

function formatTimer(seconds: number): string {
  const clamped = Math.max(0, seconds);
  if (clamped < 10 && clamped > 0) {
    return `00:0${clamped.toFixed(1)}`;
  }
  const whole = Math.ceil(clamped);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function svgIcon(
  name:
    | 'soundOn'
    | 'soundOff'
    | 'musicOn'
    | 'musicOff'
    | 'camera'
    | 'assist'
    | 'pause'
    | 'play'
    | 'coin'
    | 'trophy'
    | 'wind'
    | 'check'
    | 'lock'
    | 'shop'
    | 'restart'
    | 'home'
    | 'close'
    | 'bolt',
  size = 18
): string {
  const base = `width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`;
  switch (name) {
    case 'soundOn':
      return `<svg ${base}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
    case 'soundOff':
      return `<svg ${base}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>`;
    case 'musicOn':
      return `<svg ${base}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    case 'musicOff':
      return `<svg ${base}><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
    case 'camera':
      return `<svg ${base}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
    case 'assist':
      return `<svg ${base}><circle cx="12" cy="12" r="9"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="12" r="2.5"/></svg>`;
    case 'pause':
      return `<svg ${base}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
    case 'play':
      return `<svg ${base}><polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none"/></svg>`;
    case 'coin':
      return `<svg ${base}><circle cx="12" cy="12" r="9" fill="rgba(255, 209, 64, 0.18)"/><path d="M12 7v10"/><path d="M9.5 10.5L12 8l2.5 2.5L12 16z"/></svg>`;
    case 'trophy':
      return `<svg ${base}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;
    case 'wind':
      return `<svg ${base}><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>`;
    case 'check':
      return `<svg ${base}><polyline points="20 6 9 17 4 12"/></svg>`;
    case 'lock':
      return `<svg ${base}><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    case 'shop':
      return `<svg ${base}><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;
    case 'restart':
      return `<svg ${base}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`;
    case 'home':
      return `<svg ${base}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    case 'close':
      return `<svg ${base}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    case 'bolt':
      return `<svg ${base}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none"/></svg>`;
  }
}

function renderGearPreviewSvg(gear: KiteGear): string {
  const c1 = sanitizeColor(gear.kiteColorPrimary, '#00d4ff');
  const c2 = sanitizeColor(gear.kiteColorSecondary, '#ffffff');
  const board = sanitizeColor(gear.boardColor, '#0b2545');
  return `
    <svg class="kr-gear-svg" viewBox="0 0 160 88" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="kg-${escapeHtml(gear.id)}" x1="16" y1="8" x2="144" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${c1}"/>
          <stop offset="65%" stop-color="${c1}"/>
          <stop offset="100%" stop-color="${c2}"/>
        </linearGradient>
      </defs>
      <path d="M22 46 C38 14, 122 14, 138 46 L124 53 C106 31, 54 31, 36 53 Z" fill="url(#kg-${escapeHtml(gear.id)})" stroke="rgba(255,255,255,0.45)" stroke-width="1.3"/>
      <path d="M56 26 L61 42 M80 21 L80 39 M104 26 L99 42" stroke="${c2}" stroke-width="2.2" stroke-linecap="round" opacity="0.85"/>
      <path d="M23 46 C40 16, 120 16, 137 46" stroke="${c2}" stroke-width="3" stroke-linecap="round" opacity="0.9"/>
      <line x1="36" y1="53" x2="66" y2="71" stroke="rgba(220,240,255,0.35)" stroke-width="1"/>
      <line x1="124" y1="53" x2="94" y2="71" stroke="rgba(220,240,255,0.35)" stroke-width="1"/>
      <rect x="44" y="69" width="72" height="12" rx="6" fill="${board}" stroke="${c1}" stroke-width="1.5"/>
      <rect x="61" y="72" width="10" height="6" rx="2" fill="${c2}" opacity="0.8"/>
      <rect x="89" y="72" width="10" height="6" rx="2" fill="${c2}" opacity="0.8"/>
    </svg>
  `;
}

export class UIManager {
  private readonly callbacks: UICallbacks;
  private readonly root: HTMLDivElement;

  private gearCatalog: KiteGear[];
  private missions: MissionDef[];
  private selectedMode: GameMode;
  private currentState: GameState = 'MENU';
  private localShopOpen = false;
  private shopReturnState: GameState = 'MENU';
  private shopTab: 'GEAR' | 'MISSIONS' = 'GEAR';

  private audioMuted = false;
  private musicEnabled = true;
  private autoAssist = false;
  private cameraLabel = 'CHASE';

  private displayedScore = 0;
  private targetScore = 0;
  private lastRunCoins = 0;
  private lastGameState: GameState = 'MENU';
  private lastWipeout = false;
  private lastAirborne = false;
  private wasRecordTriggeredThisAir = false;
  private altimeterLingerTimer = 0;
  private altimeterPeakDisplay = 0;
  private bestComboRun = 1;
  private maxHeightRun = 0;
  private lastTricksCount = 0;

  private tutorialDismissed = false;
  private tutorialSteerDone = false;
  private tutorialJumpDone = false;
  private tutorialTrickDone = false;
  private tutorialDoneHoldTimer = 0;

  private calloutTimer = 0;
  private trickFeedIdSeq = 0;
  private kiteTrail: Array<{ x: number; y: number }> = [];
  private trailSampleTimer = 0;
  private lastShopSignature = '';
  private lastMenuSignature = '';
  private lastToggleSignature = '';
  private lastSaveData: PlayerSaveData = {
    highScores: { ENDLESS: 0, BIG_AIR: 0, FREESTYLE: 0, SLALOM: 0 },
    maxHeightRecord: 0,
    coins: 0,
    unlockedGear: ['tradewind-classic'],
    equippedGear: 'tradewind-classic',
    completedMissions: [],
  };

  // Cached DOM references
  private hudTopEl!: HTMLDivElement;
  private scoreEl!: HTMLDivElement;
  private comboWrapEl!: HTMLDivElement;
  private comboMultEl!: HTMLSpanElement;
  private comboPtsEl!: HTMLSpanElement;
  private comboFillEl!: HTMLDivElement;
  private speedEl!: HTMLSpanElement;
  private distEl!: HTMLSpanElement;
  private coinsEl!: HTMLSpanElement;
  private coinsPillEl!: HTMLDivElement;
  private modeBadgeEl!: HTMLSpanElement;
  private timerEl!: HTMLSpanElement;
  private timerWrapEl!: HTMLDivElement;
  private windValEl!: HTMLSpanElement;

  private btnAudioEl!: HTMLButtonElement;
  private btnMusicEl!: HTMLButtonElement;
  private btnCameraEl!: HTMLButtonElement;
  private btnCameraLabelEl!: HTMLSpanElement;
  private btnAssistEl!: HTMLButtonElement;
  private btnAssistLabelEl!: HTMLSpanElement;
  private btnPauseEl!: HTMLButtonElement;

  private altimeterEl!: HTMLDivElement;
  private altValueEl!: HTMLSpanElement;
  private hangValueEl!: HTMLSpanElement;
  private peakValueEl!: HTMLSpanElement;
  private altBarFillEl!: HTMLDivElement;
  private altRecordBadgeEl!: HTMLDivElement;

  private windDockEl!: HTMLDivElement;
  private kiteMarkerEl!: SVGGElement;
  private kiteCanopyEl!: SVGPathElement;
  private kiteGlowEl!: SVGCircleElement;
  private kiteLineLeftEl!: SVGLineElement;
  private kiteLineRightEl!: SVGLineElement;
  private kiteTrailPathEl!: SVGPathElement;
  private kiteLoopHaloEl!: SVGCircleElement;
  private tensionFillEl!: HTMLDivElement;
  private tensionPctEl!: HTMLSpanElement;
  private tensionStatusEl!: HTMLSpanElement;
  private tensionMeterWrapEl!: HTMLDivElement;

  private calloutEl!: HTMLDivElement;
  private calloutTitleEl!: HTMLDivElement;
  private calloutSubEl!: HTMLDivElement;
  private trickFeedEl!: HTMLDivElement;

  private tutorialEl!: HTMLDivElement;
  private tutStep1El!: HTMLDivElement;
  private tutStep2El!: HTMLDivElement;
  private tutStep3El!: HTMLDivElement;

  private menuScreenEl!: HTMLDivElement;
  private menuModesEl!: HTMLDivElement;
  private menuSelectedTitleEl!: HTMLHeadingElement;
  private menuSelectedDescEl!: HTMLParagraphElement;
  private menuSelectedBestEl!: HTMLSpanElement;
  private menuRecordMaxAirEl!: HTMLSpanElement;
  private menuRecordCoinsEl!: HTMLSpanElement;
  private menuRecordMissionsEl!: HTMLSpanElement;
  private menuShopBadgeEl!: HTMLSpanElement;
  private menuAudioBtnEl!: HTMLButtonElement;
  private menuMusicBtnEl!: HTMLButtonElement;
  private menuAssistBtnEl!: HTMLButtonElement;

  private shopScreenEl!: HTMLDivElement;
  private shopCoinsEl!: HTMLSpanElement;
  private shopEquippedEl!: HTMLSpanElement;
  private shopGearGridEl!: HTMLDivElement;
  private shopMissionsListEl!: HTMLDivElement;
  private shopMissionCountEl!: HTMLSpanElement;
  private shopTabGearBtn!: HTMLButtonElement;
  private shopTabMissionsBtn!: HTMLButtonElement;
  private shopGearPaneEl!: HTMLDivElement;
  private shopMissionsPaneEl!: HTMLDivElement;

  private pauseScreenEl!: HTMLDivElement;
  private pauseModeEl!: HTMLSpanElement;
  private pauseScoreEl!: HTMLSpanElement;
  private pauseAirEl!: HTMLSpanElement;
  private pauseDistEl!: HTMLSpanElement;
  private pauseAudioBtnEl!: HTMLButtonElement;
  private pauseMusicBtnEl!: HTMLButtonElement;
  private pauseAssistBtnEl!: HTMLButtonElement;
  private pauseCameraBtnEl!: HTMLButtonElement;

  private gameoverScreenEl!: HTMLDivElement;
  private goModeEl!: HTMLSpanElement;
  private goNewBestEl!: HTMLSpanElement;
  private goScoreEl!: HTMLDivElement;
  private goMaxAirEl!: HTMLSpanElement;
  private goBestComboEl!: HTMLSpanElement;
  private goDistanceEl!: HTMLSpanElement;
  private goTricksEl!: HTMLSpanElement;
  private goCoinsEl!: HTMLSpanElement;

  constructor(callbacks: UICallbacks, options: UIManagerOptions = {}) {
    this.callbacks = callbacks;
    this.gearCatalog = options.gearCatalog ?? GEAR_CATALOG;
    this.missions = options.missions ?? MISSIONS_CATALOG;
    this.selectedMode = options.initialMode ?? 'BIG_AIR';
    this.audioMuted = options.audioMuted ?? false;
    this.musicEnabled = options.musicEnabled ?? true;
    this.autoAssist = options.autoAssist ?? false;
    this.cameraLabel = options.cameraLabel ?? 'CHASE';

    this.injectStyles();

    const mountTarget = options.container ?? document.body;
    const existingRoot = document.getElementById(ROOT_ID);
    if (existingRoot) {
      existingRoot.remove();
    }

    this.root = document.createElement('div');
    this.root.id = ROOT_ID;
    this.root.innerHTML = this.buildMarkup();
    mountTarget.appendChild(this.root);

    this.bindElements();
    this.bindEvents();
    this.syncToggleVisuals();
    this.renderMenuDynamic(true);
    this.renderShopDynamic(true);
    this.applyScreenVisibility('MENU');
  }

  public getSelectedMode(): GameMode {
    return this.selectedMode;
  }

  public getState(): GameState {
    return this.currentState;
  }

  public setShopCatalog(gearCatalog: KiteGear[], missions: MissionDef[]): void {
    this.gearCatalog = gearCatalog;
    this.missions = missions;
    this.lastShopSignature = '';
    this.lastMenuSignature = '';
    this.renderShopDynamic(true);
    this.renderMenuDynamic(true);
  }

  public setSaveData(saveData: PlayerSaveData): void {
    this.lastSaveData = saveData;
    this.renderMenuDynamic();
    this.renderShopDynamic();
  }

  public setToggleStates(states: {
    audioMuted?: boolean;
    musicEnabled?: boolean;
    autoAssist?: boolean;
    cameraLabel?: string;
  }): void {
    if (states.audioMuted !== undefined) this.audioMuted = states.audioMuted;
    if (states.musicEnabled !== undefined) this.musicEnabled = states.musicEnabled;
    if (states.autoAssist !== undefined) this.autoAssist = states.autoAssist;
    if (states.cameraLabel !== undefined) this.cameraLabel = states.cameraLabel;
    this.syncToggleVisuals();
  }

  public resetRunUI(): void {
    this.displayedScore = 0;
    this.targetScore = 0;
    this.lastRunCoins = 0;
    this.lastWipeout = false;
    this.lastAirborne = false;
    this.wasRecordTriggeredThisAir = false;
    this.altimeterLingerTimer = 0;
    this.altimeterPeakDisplay = 0;
    this.bestComboRun = 1;
    this.maxHeightRun = 0;
    this.lastTricksCount = 0;
    this.kiteTrail = [];
    this.calloutTimer = 0;
    this.calloutEl.classList.remove('is-visible');
    this.trickFeedEl.innerHTML = '';
    this.altimeterEl.classList.remove('is-visible', 'is-record');
    this.tutorialDoneHoldTimer = 0;
    this.scoreEl.textContent = '0';
    this.distEl.textContent = '0m';
    this.coinsEl.textContent = '0';
  }

  public pushTrickEvent(event: TrickEvent): void {
    const styleClass = this.styleToClass(event.style);
    const ptsText = event.points > 0 ? `+${formatScore(event.points)}` : '';
    const multText = event.multiplierDelta > 0 ? `+${event.multiplierDelta}x` : '';
    this.appendFeedPill(event.name, `${ptsText} ${multText}`.trim(), styleClass);

    if (event.style === 'KITELOOP' || event.style === 'COMBO' || event.points >= 600) {
      const variant: CalloutVariant = event.style === 'KITELOOP' ? 'boost' : 'trick';
      this.showCallout(event.name, ptsText || 'BIG STYLE!', variant);
      this.tutorialTrickDone = true;
    } else if (event.style === 'LANDING') {
      const clean = !event.name.toLowerCase().includes('sketch') && !event.name.toLowerCase().includes('wipe');
      this.showCallout(event.name, clean ? '+SPEED' : 'HOLD ON!', clean ? 'landing' : 'warning');
    } else if (event.style === 'GRAB' || event.style === 'ROTATION') {
      this.tutorialTrickDone = true;
    }
    this.lastTricksCount += 1;
  }

  public pushWorldEvent(event: WorldEvent): void {
    switch (event.type) {
      case 'RAMP_BOOST':
        this.appendFeedPill(event.label ?? 'KICKER LAUNCH', `+${formatScore(event.points)}`, 'boost');
        this.showCallout('RAMP LAUNCH!', `+${formatScore(event.points)} • AIR BOOST`, 'boost');
        break;
      case 'RING_PASS':
        this.appendFeedPill(event.label ?? 'SKY RING', `+${formatScore(event.points)}`, 'record');
        this.showCallout('SKY RING THREADED!', `+${formatScore(event.points)} • +${event.coins} COINS`, 'record');
        break;
      case 'GATE_CLEAR':
        this.appendFeedPill(event.label ?? 'GATE CLEAR', `+${formatScore(event.points)}`, 'landing');
        break;
      case 'GUST_LIFT':
        this.appendFeedPill(event.label ?? 'THERMAL GUST', '+LIFT', 'boost');
        break;
      case 'HAZARD_HIT':
        this.appendFeedPill(event.label ?? 'HAZARD IMPACT', 'WIPEOUT', 'wipeout');
        this.showCallout('WIPEOUT!', event.label ?? 'DODGE OBSTACLES', 'wipeout');
        break;
      case 'COIN_PICKUP':
        // Coin counter pulse handles pickups subtly without spamming feed
        break;
    }
  }

  public showCallout(title: string, subtitle = '', variant: CalloutVariant = 'trick'): void {
    this.calloutTitleEl.textContent = title;
    this.calloutSubEl.textContent = subtitle;
    this.calloutSubEl.style.display = subtitle ? 'block' : 'none';
    this.calloutEl.dataset.variant = variant;
    this.calloutEl.classList.remove('is-visible');
    void this.calloutEl.offsetWidth;
    this.calloutEl.classList.add('is-visible');
    this.calloutTimer = variant === 'wipeout' ? 2.0 : 1.85;
  }

  public setRunSummary(summary: RunSummary): void {
    this.goModeEl.textContent = MODE_MAP[summary.mode].title.toUpperCase();
    this.goNewBestEl.classList.toggle('is-visible', summary.isNewBest);
    this.goScoreEl.textContent = formatScore(summary.score);
    this.goMaxAirEl.textContent = `${summary.maxJumpHeight.toFixed(1)}m`;
    this.goBestComboEl.textContent =
      summary.bestCombo >= 20
        ? `${formatScore(summary.bestCombo)} PTS`
        : summary.bestCombo >= 1
        ? `x${Math.round(summary.bestCombo)}`
        : '—';
    this.goDistanceEl.textContent = formatMeters(summary.distance);
    this.goTricksEl.textContent = String(summary.tricksLanded);
    this.goCoinsEl.textContent = `+${formatScore(summary.coinsEarned)}`;
  }

  public update(data: UIUpdateData): void {
    const dt = clamp(data.dt || 0.016, 0.001, 0.1);
    this.lastSaveData = data.saveData;

    if (data.gearCatalog) this.gearCatalog = data.gearCatalog;
    if (data.missions) this.missions = data.missions;
    if (data.audioMuted !== undefined) this.audioMuted = data.audioMuted;
    if (data.musicEnabled !== undefined) this.musicEnabled = data.musicEnabled;
    if (data.autoAssist !== undefined) this.autoAssist = data.autoAssist;
    if (data.cameraLabel !== undefined) this.cameraLabel = data.cameraLabel;
    this.syncToggleVisuals();

    // Detect explicit external GameState transitions
    const prevState = this.lastGameState;
    if (data.gameState !== prevState) {
      if (prevState === 'MENU' && data.gameState === 'PLAYING') {
        this.resetRunUI();
      }
      if (data.gameState === 'SHOP') {
        this.localShopOpen = true;
      } else if (prevState === 'SHOP' || data.gameState === 'PLAYING' || data.gameState === 'PAUSED') {
        this.localShopOpen = false;
      }
      const returningFromRun =
        data.gameState === 'MENU' &&
        (prevState === 'PLAYING' || prevState === 'PAUSED' || prevState === 'GAME_OVER');
      if (data.gameState === 'PLAYING' || data.gameState === 'PAUSED' || data.gameState === 'GAME_OVER' || returningFromRun) {
        this.selectedMode = data.mode;
      }
      this.lastGameState = data.gameState;
    } else if (data.gameState === 'PLAYING' || data.gameState === 'PAUSED' || data.gameState === 'GAME_OVER') {
      this.selectedMode = data.mode;
    }

    const effectiveState: GameState = this.localShopOpen ? 'SHOP' : data.gameState;
    this.currentState = effectiveState;
    this.applyScreenVisibility(effectiveState);

    if (effectiveState === 'MENU') {
      this.renderMenuDynamic();
    } else if (effectiveState === 'SHOP') {
      this.renderShopDynamic();
    } else if (effectiveState === 'PAUSED') {
      this.pauseModeEl.textContent = MODE_MAP[data.mode].title.toUpperCase();
      this.pauseScoreEl.textContent = formatScore(data.score);
      this.pauseAirEl.textContent = `${this.maxHeightRun.toFixed(1)}m`;
      this.pauseDistEl.textContent = formatMeters(data.distance);
    } else if (effectiveState === 'GAME_OVER') {
      if (data.runSummary) {
        this.setRunSummary(data.runSummary);
      } else {
        this.setRunSummary({
          mode: data.mode,
          score: data.score,
          isNewBest: data.score > (data.saveData.highScores[data.mode] ?? 0) && data.score > 0,
          maxJumpHeight: this.maxHeightRun,
          bestCombo: this.bestComboRun,
          distance: data.distance,
          coinsEarned: data.runCoins,
          tricksLanded: this.lastTricksCount,
        });
      }
    }

    // Consume pushed frame events
    if (data.newTricks && data.newTricks.length > 0) {
      for (const trick of data.newTricks) {
        this.pushTrickEvent(trick);
      }
    }
    if (data.newWorldEvents && data.newWorldEvents.length > 0) {
      for (const ev of data.newWorldEvents) {
        this.pushWorldEvent(ev);
      }
    }

    // Update live HUD telemetry during PLAYING (and keep frozen state coherent if paused)
    if (effectiveState === 'PLAYING') {
      this.updateActiveHud(dt, data);
    }
  }

  public dispose(): void {
    this.root.remove();
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  }

  private updateActiveHud(dt: number, data: UIUpdateData): void {
    const { physics } = data;

    // 1. Roll-up score
    this.targetScore = Math.max(0, data.score);
    const diff = this.targetScore - this.displayedScore;
    if (Math.abs(diff) < 1.5) {
      this.displayedScore = this.targetScore;
    } else {
      this.displayedScore += diff * Math.min(1, dt * 14);
    }
    this.scoreEl.textContent = formatScore(this.displayedScore);

    // 2. Combo multiplier & decay timer
    const mult = Math.max(1, Math.round(data.comboMultiplier));
    this.bestComboRun = Math.max(this.bestComboRun, mult);
    const comboMax = data.comboMaxTime ?? (data.comboTimer > 1.0 ? 4.2 : 1.0);
    const comboRatio = clamp(data.comboTimer / Math.max(0.001, comboMax), 0, 1);
    const comboActive = mult > 1 || (data.comboPoints ?? 0) > 0 || comboRatio > 0.01;
    this.comboWrapEl.classList.toggle('is-active', comboActive);
    this.comboMultEl.textContent = `x${mult}`;
    if (data.activeTrickLabel) {
      this.comboPtsEl.textContent = data.activeTrickLabel;
    } else if ((data.comboPoints ?? 0) > 0) {
      this.comboPtsEl.textContent = `+${formatScore(data.comboPoints ?? 0)}`;
    } else {
      this.comboPtsEl.textContent = mult > 1 ? 'COMBO CHAIN' : 'READY';
    }
    this.comboFillEl.style.transform = `scaleX(${comboRatio.toFixed(3)})`;
    this.comboWrapEl.classList.toggle('is-urgent', comboActive && comboRatio > 0 && comboRatio < 0.28);

    // 3. Speed in knots, distance, coins, wind
    const speedMs = Math.hypot(physics.velocity.x, physics.velocity.z);
    const knots = data.speedKnots ?? speedMs * 1.94384;
    this.speedEl.textContent = `${Math.round(knots)}`;
    this.distEl.textContent = formatMeters(data.distance);

    if (data.runCoins !== this.lastRunCoins) {
      if (data.runCoins > this.lastRunCoins) {
        this.coinsPillEl.classList.remove('is-pop');
        void this.coinsPillEl.offsetWidth;
        this.coinsPillEl.classList.add('is-pop');
      }
      this.lastRunCoins = data.runCoins;
    }
    this.coinsEl.textContent = formatScore(data.runCoins);

    const windKts = Math.round((physics.windSpeed || 12) * 1.94384);
    this.windValEl.textContent = `${windKts} KTS`;

    // 4. Mode badge & timer
    const meta = MODE_MAP[data.mode];
    this.modeBadgeEl.textContent = meta.title.toUpperCase();
    if (data.mode === 'ENDLESS') {
      this.timerEl.textContent = formatElapsed(data.elapsedTime ?? 0);
      this.timerWrapEl.classList.remove('is-urgent');
    } else {
      const remaining = data.timeRemaining ?? 90;
      this.timerEl.textContent = formatTimer(remaining);
      this.timerWrapEl.classList.toggle('is-urgent', remaining <= 10 && remaining > 0);
    }

    // 5. Big Air Altimeter & Hangtime Gauge
    if (physics.maxJumpHeightThisAir > this.maxHeightRun) {
      this.maxHeightRun = physics.maxJumpHeightThisAir;
    }

    const isRecordNow =
      physics.maxJumpHeightThisAir > data.saveData.maxHeightRecord &&
      physics.maxJumpHeightThisAir >= 2.0;

    if (physics.isAirborne) {
      if (!this.lastAirborne) {
        this.altimeterPeakDisplay = 0;
        this.wasRecordTriggeredThisAir = false;
      }
      this.altimeterLingerTimer = 1.25;
      this.altimeterPeakDisplay = Math.max(
        this.altimeterPeakDisplay,
        physics.maxJumpHeightThisAir,
        physics.currentJumpHeight
      );
      this.altValueEl.textContent = `${Math.max(0, physics.currentJumpHeight).toFixed(1)}m`;
      this.hangValueEl.textContent = `${Math.max(0, physics.airTime).toFixed(1)}s`;
      this.peakValueEl.textContent = `${this.altimeterPeakDisplay.toFixed(1)}m`;
      const fillRatio = clamp(physics.currentJumpHeight / 35, 0.04, 1);
      this.altBarFillEl.style.transform = `scaleY(${fillRatio.toFixed(3)})`;
      this.altimeterEl.classList.add('is-visible');
      this.altimeterEl.classList.toggle('is-record', isRecordNow);
      this.altRecordBadgeEl.classList.toggle('is-visible', isRecordNow);

      if (isRecordNow && !this.wasRecordTriggeredThisAir) {
        this.wasRecordTriggeredThisAir = true;
        this.showCallout('NEW HEIGHT RECORD!', `${physics.maxJumpHeightThisAir.toFixed(1)}m BIG AIR`, 'record');
      }
      if (physics.currentJumpHeight > 1.2) {
        this.tutorialJumpDone = true;
      }
      if (physics.inKiteloop) {
        this.tutorialTrickDone = true;
      }
    } else {
      if (this.lastAirborne && !physics.wipeout && this.altimeterPeakDisplay >= 4.0) {
        this.altValueEl.textContent = `${this.altimeterPeakDisplay.toFixed(1)}m`;
        this.peakValueEl.textContent = `${this.altimeterPeakDisplay.toFixed(1)}m`;
      }
      this.wasRecordTriggeredThisAir = false;
      if (this.altimeterLingerTimer > 0 && this.altimeterPeakDisplay >= 2.0) {
        this.altimeterLingerTimer -= dt;
        this.altimeterEl.classList.add('is-visible');
      } else {
        this.altimeterEl.classList.remove('is-visible', 'is-record');
        this.altRecordBadgeEl.classList.remove('is-visible');
      }
    }
    this.lastAirborne = physics.isAirborne;

    // 6. Wipeout edge detection
    if (physics.wipeout && !this.lastWipeout) {
      this.showCallout('WIPEOUT!', 'RECOVERING ON WATER', 'wipeout');
    }
    this.lastWipeout = physics.wipeout;

    // 7. Wind Window Mini-Dome & Line Tension Meter
    this.updateWindWindowAndTension(dt, physics);

    // 8. Callout timer
    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) {
        this.calloutEl.classList.remove('is-visible');
      }
    }

    // 9. Tutorial prompts (first 30 seconds on fresh run)
    this.updateTutorial(dt, data);
  }

  private updateWindWindowAndTension(dt: number, physics: PhysicsState): void {
    const azDeg = clamp(physics.kiteAzimuth, -85, 85);
    const elDeg = clamp(physics.kiteElevation, 5, 89);

    if (Math.abs(azDeg) > 20 || Math.abs(physics.kiteAngularVel) > 0.35) {
      this.tutorialSteerDone = true;
    }

    const azRad = (azDeg * Math.PI) / 180;
    const elRad = (elDeg * Math.PI) / 180;
    const px = 120 + Math.sin(azRad) * Math.cos(elRad * 0.72) * 100;
    const py = 120 - Math.sin(elRad) * 100;
    const rollDeg = (physics.kiteRoll * 180) / Math.PI;

    this.kiteMarkerEl.setAttribute(
      'transform',
      `translate(${px.toFixed(1)} ${py.toFixed(1)}) rotate(${rollDeg.toFixed(1)})`
    );

    const wingSpreadX = Math.cos((rollDeg * Math.PI) / 180) * 9;
    const wingSpreadY = Math.sin((rollDeg * Math.PI) / 180) * 9;
    this.kiteLineLeftEl.setAttribute('x2', (px - wingSpreadX).toFixed(1));
    this.kiteLineLeftEl.setAttribute('y2', (py - wingSpreadY).toFixed(1));
    this.kiteLineRightEl.setAttribute('x2', (px + wingSpreadX).toFixed(1));
    this.kiteLineRightEl.setAttribute('y2', (py + wingSpreadY).toFixed(1));

    // Trail history sampled ~25Hz
    this.trailSampleTimer += dt;
    if (this.trailSampleTimer >= 0.04) {
      this.trailSampleTimer = 0;
      this.kiteTrail.push({ x: px, y: py });
      if (this.kiteTrail.length > 14) {
        this.kiteTrail.shift();
      }
      if (this.kiteTrail.length >= 2) {
        const d = this.kiteTrail
          .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
          .join(' ');
        this.kiteTrailPathEl.setAttribute('d', d);
      }
    }

    this.kiteLoopHaloEl.setAttribute('opacity', physics.inKiteloop ? '1' : '0');

    const tension = clamp(physics.lineTension, 0, 1);
    const tensionPct = Math.round(tension * 100);
    this.tensionFillEl.style.transform = `scaleX(${tension.toFixed(3)})`;
    this.tensionPctEl.textContent = `${tensionPct}%`;

    const inZenith = elDeg >= 64 && Math.abs(azDeg) <= 30;
    const primed = tension >= 0.65;

    const kiteColor = physics.inKiteloop
      ? '#FF3B5C'
      : primed || inZenith
      ? '#FFD43B'
      : '#00E5FF';
    const kiteGlow = physics.inKiteloop
      ? 'rgba(255, 59, 92, 0.34)'
      : primed || inZenith
      ? 'rgba(255, 212, 59, 0.3)'
      : 'rgba(0, 229, 255, 0.22)';
    this.kiteCanopyEl.setAttribute('fill', kiteColor);
    this.kiteGlowEl.setAttribute('fill', kiteGlow);

    this.tensionMeterWrapEl.classList.toggle('is-primed', primed || physics.inKiteloop);
    this.tensionMeterWrapEl.classList.toggle('is-zenith', inZenith && !physics.isAirborne);
    this.tensionMeterWrapEl.classList.toggle('is-looping', physics.inKiteloop);

    if (physics.wipeout) {
      this.tensionStatusEl.textContent = 'WIPEOUT • RECOVERING';
    } else if (physics.inKiteloop) {
      this.tensionStatusEl.textContent = 'KITELOOPING!';
    } else if (physics.isAirborne && physics.currentJumpHeight >= 1.5) {
      this.tensionStatusEl.textContent = 'AIR • SPACE TO LOOP!';
    } else if (!physics.isAirborne && inZenith && tension >= 0.42) {
      this.tensionStatusEl.textContent = '12 O’CLOCK • PRESS SPACE!';
    } else if (primed) {
      this.tensionStatusEl.textContent = 'LOAD & POP!';
    } else {
      this.tensionStatusEl.textContent = 'LINE TENSION';
    }
  }

  private updateTutorial(dt: number, data: UIUpdateData): void {
    const elapsed = data.elapsedTime ?? 0;
    const allDone = this.tutorialSteerDone && this.tutorialJumpDone && this.tutorialTrickDone;
    if (allDone) {
      this.tutorialDoneHoldTimer += dt;
    }

    const shouldShow =
      !this.tutorialDismissed &&
      elapsed < 30 &&
      this.tutorialDoneHoldTimer < 2.2 &&
      (data.saveData.maxHeightRecord < 25 || !allDone);

    this.tutorialEl.classList.toggle('is-visible', shouldShow);
    if (!shouldShow) return;

    this.tutStep1El.classList.toggle('is-done', this.tutorialSteerDone);
    this.tutStep2El.classList.toggle('is-done', this.tutorialJumpDone);
    this.tutStep3El.classList.toggle('is-done', this.tutorialTrickDone);

    let activeStep = 1;
    if (this.tutorialSteerDone || elapsed >= 9) activeStep = 2;
    if ((this.tutorialSteerDone && this.tutorialJumpDone) || elapsed >= 19) activeStep = 3;
    if (allDone) activeStep = 3;

    this.tutStep1El.classList.toggle('is-active', activeStep === 1);
    this.tutStep2El.classList.toggle('is-active', activeStep === 2);
    this.tutStep3El.classList.toggle('is-active', activeStep === 3);
  }

  private appendFeedPill(title: string, detail: string, variantClass: string): void {
    const id = ++this.trickFeedIdSeq;
    const item = document.createElement('div');
    item.className = `kr-feed-item kr-feed-${variantClass}`;
    item.dataset.feedId = String(id);
    item.innerHTML = `
      <span class="kr-feed-name">${escapeHtml(title)}</span>
      ${detail ? `<span class="kr-feed-pts">${escapeHtml(detail)}</span>` : ''}
    `;
    this.trickFeedEl.prepend(item);
    while (this.trickFeedEl.children.length > 4) {
      this.trickFeedEl.lastElementChild?.remove();
    }
    window.setTimeout(() => {
      item.classList.add('is-fading');
      window.setTimeout(() => {
        if (item.parentElement === this.trickFeedEl) {
          item.remove();
        }
      }, 280);
    }, 3100);
  }

  private styleToClass(style: TrickStyle): string {
    switch (style) {
      case 'KITELOOP':
        return 'boost';
      case 'COMBO':
        return 'record';
      case 'LANDING':
        return 'landing';
      case 'ROTATION':
      case 'GRAB':
        return 'trick';
    }
  }

  private applyScreenVisibility(state: GameState): void {
    this.root.dataset.state = state;
    const isPlaying = state === 'PLAYING';
    const isPaused = state === 'PAUSED';
    this.hudTopEl.classList.toggle('is-visible', isPlaying || isPaused);
    this.windDockEl.classList.toggle('is-visible', isPlaying);
    this.menuScreenEl.classList.toggle('is-visible', state === 'MENU');
    this.shopScreenEl.classList.toggle('is-visible', state === 'SHOP');
    this.pauseScreenEl.classList.toggle('is-visible', state === 'PAUSED');
    this.gameoverScreenEl.classList.toggle('is-visible', state === 'GAME_OVER');

    if (!isPlaying) {
      this.tutorialEl.classList.remove('is-visible');
    }
    if (state !== 'PLAYING' && state !== 'PAUSED') {
      this.altimeterEl.classList.remove('is-visible');
      this.calloutEl.classList.remove('is-visible');
    }
  }

  private syncToggleVisuals(): void {
    const sig = `${this.audioMuted}|${this.musicEnabled}|${this.autoAssist}|${this.cameraLabel}`;
    if (sig === this.lastToggleSignature) return;
    this.lastToggleSignature = sig;

    this.btnAudioEl.innerHTML = svgIcon(this.audioMuted ? 'soundOff' : 'soundOn', 17);
    this.btnAudioEl.classList.toggle('is-off', this.audioMuted);
    this.btnAudioEl.setAttribute('aria-pressed', String(!this.audioMuted));

    this.btnMusicEl.innerHTML = svgIcon(this.musicEnabled ? 'musicOn' : 'musicOff', 17);
    this.btnMusicEl.classList.toggle('is-off', !this.musicEnabled);
    this.btnMusicEl.setAttribute('aria-pressed', String(this.musicEnabled));

    this.btnCameraLabelEl.textContent = this.cameraLabel.toUpperCase();
    this.btnAssistEl.classList.toggle('is-active', this.autoAssist);
    this.btnAssistLabelEl.textContent = this.autoAssist ? 'ASSIST' : 'FREE RIDE';
    this.btnAssistEl.setAttribute('aria-pressed', String(this.autoAssist));

    // Menu & Pause mirrors
    this.menuAudioBtnEl.innerHTML = `${svgIcon(this.audioMuted ? 'soundOff' : 'soundOn', 16)}<span>${this.audioMuted ? 'SFX OFF' : 'SFX ON'}</span>`;
    this.menuAudioBtnEl.classList.toggle('is-off', this.audioMuted);
    this.menuMusicBtnEl.innerHTML = `${svgIcon(this.musicEnabled ? 'musicOn' : 'musicOff', 16)}<span>${this.musicEnabled ? 'MUSIC ON' : 'MUSIC OFF'}</span>`;
    this.menuMusicBtnEl.classList.toggle('is-off', !this.musicEnabled);
    this.menuAssistBtnEl.innerHTML = `${svgIcon('assist', 16)}<span>${this.autoAssist ? 'COURSE PULL: ON' : 'FREE RIDE: ON'}</span>`;
    this.menuAssistBtnEl.classList.toggle('is-active', this.autoAssist);
    this.menuAssistBtnEl.classList.toggle('is-off', !this.autoAssist);
    this.menuAssistBtnEl.setAttribute('aria-pressed', String(this.autoAssist));

    this.pauseAudioBtnEl.innerHTML = `${svgIcon(this.audioMuted ? 'soundOff' : 'soundOn', 16)}<span>${this.audioMuted ? 'Audio Muted' : 'Audio Active'}</span>`;
    this.pauseMusicBtnEl.innerHTML = `${svgIcon(this.musicEnabled ? 'musicOn' : 'musicOff', 16)}<span>${this.musicEnabled ? 'Music On' : 'Music Off'}</span>`;
    this.pauseAssistBtnEl.innerHTML = `${svgIcon('assist', 16)}<span>${this.autoAssist ? 'Course Pull: ON (Helper)' : 'Course Pull: OFF (Free Ride)'}</span>`;
    this.pauseCameraBtnEl.innerHTML = `${svgIcon('camera', 16)}<span>Camera: ${escapeHtml(this.cameraLabel.toUpperCase())}</span>`;
  }

  private renderMenuDynamic(force = false): void {
    const save = this.lastSaveData;
    const sig = `${this.selectedMode}|${save.coins}|${save.maxHeightRecord.toFixed(1)}|${save.completedMissions.length}|${save.unlockedGear.join(',')}|${JSON.stringify(save.highScores)}`;
    if (!force && sig === this.lastMenuSignature) return;
    this.lastMenuSignature = sig;

    const selectedMeta = MODE_MAP[this.selectedMode];
    this.menuSelectedTitleEl.textContent = selectedMeta.title;
    this.menuSelectedDescEl.textContent = selectedMeta.description;
    this.menuSelectedBestEl.textContent = formatScore(save.highScores[this.selectedMode] ?? 0);

    this.menuRecordMaxAirEl.textContent = `${save.maxHeightRecord.toFixed(1)}m`;
    this.menuRecordCoinsEl.textContent = formatScore(save.coins);
    this.menuRecordMissionsEl.textContent = `${save.completedMissions.length}/${this.missions.length}`;

    const canUnlockAny = this.gearCatalog.some(
      (g) => !save.unlockedGear.includes(g.id) && save.coins >= g.cost
    );
    this.menuShopBadgeEl.textContent = canUnlockAny ? 'UNLOCK READY' : `${formatScore(save.coins)} COINS`;
    this.menuShopBadgeEl.classList.toggle('is-ready', canUnlockAny);

    this.menuModesEl.innerHTML = MODE_DEFINITIONS.map((m) => {
      const isSelected = m.id === this.selectedMode;
      const best = save.highScores[m.id] ?? 0;
      return `
        <button type="button" class="kr-mode-card ${isSelected ? 'is-selected' : ''}" data-mode="${m.id}">
          <div class="kr-mode-top">
            <span class="kr-mode-name">${escapeHtml(m.title)}</span>
            <span class="kr-mode-pill">${escapeHtml(m.badge)}</span>
          </div>
          <p class="kr-mode-copy">${escapeHtml(m.description)}</p>
          <div class="kr-mode-foot">
            <span class="kr-mode-best-lbl">BEST</span>
            <span class="kr-mode-best-val">${formatScore(best)}</span>
          </div>
        </button>
      `;
    }).join('');
  }

  private renderShopDynamic(force = false): void {
    const save = this.lastSaveData;
    const sig = `${save.coins}|${save.equippedGear}|${save.unlockedGear.join(',')}|${save.completedMissions.join(',')}|${this.shopTab}|${this.gearCatalog.length}|${this.missions.length}`;
    if (!force && sig === this.lastShopSignature) return;
    this.lastShopSignature = sig;

    this.shopCoinsEl.textContent = formatScore(save.coins);
    const equipped = this.gearCatalog.find((g) => g.id === save.equippedGear) ?? this.gearCatalog[0];
    this.shopEquippedEl.textContent = equipped ? equipped.name : 'Stock Rig';

    this.shopTabGearBtn.classList.toggle('is-active', this.shopTab === 'GEAR');
    this.shopTabMissionsBtn.classList.toggle('is-active', this.shopTab === 'MISSIONS');
    this.shopGearPaneEl.classList.toggle('is-mobile-active', this.shopTab === 'GEAR');
    this.shopMissionsPaneEl.classList.toggle('is-mobile-active', this.shopTab === 'MISSIONS');

    this.shopMissionCountEl.textContent = `${save.completedMissions.length}/${this.missions.length}`;

    this.shopGearGridEl.innerHTML = this.gearCatalog
      .map((gear) => {
        const isUnlocked = save.unlockedGear.includes(gear.id) || gear.cost === 0;
        const isEquipped = save.equippedGear === gear.id;
        const canAfford = save.coins >= gear.cost;

        const boostPct = clamp(24 + (gear.boostBonus / 0.42) * 76, 20, 100);
        const turnPct = clamp(24 + (gear.turnSpeedBonus / 0.42) * 76, 20, 100);
        const hangPct = clamp(24 + (gear.hangtimeBonus / 0.42) * 76, 20, 100);

        let actionHtml = '';
        if (isEquipped) {
          actionHtml = `<button type="button" class="kr-gear-btn is-equipped" disabled>${svgIcon('check', 15)}<span>EQUIPPED</span></button>`;
        } else if (isUnlocked) {
          actionHtml = `<button type="button" class="kr-gear-btn is-equip" data-gear-action="equip" data-gear-id="${escapeHtml(gear.id)}"><span>EQUIP RIG</span></button>`;
        } else if (canAfford) {
          actionHtml = `<button type="button" class="kr-gear-btn is-unlock" data-gear-action="unlock" data-gear-id="${escapeHtml(gear.id)}">${svgIcon('coin', 15)}<span>UNLOCK • ${formatScore(gear.cost)}</span></button>`;
        } else {
          actionHtml = `<button type="button" class="kr-gear-btn is-locked" disabled>${svgIcon('lock', 14)}<span>NEED ${formatScore(gear.cost)}</span></button>`;
        }

        return `
          <article class="kr-gear-card ${isEquipped ? 'is-equipped' : ''}">
            <div class="kr-gear-preview">
              ${renderGearPreviewSvg(gear)}
              <div class="kr-swatches">
                <span class="kr-swatch" style="background:${sanitizeColor(gear.kiteColorPrimary, '#00d4ff')}" title="Primary Canopy"></span>
                <span class="kr-swatch" style="background:${sanitizeColor(gear.kiteColorSecondary, '#ffffff')}" title="Secondary Accent"></span>
                <span class="kr-swatch" style="background:${sanitizeColor(gear.boardColor, '#0b2545')}" title="Twin-Tip Board"></span>
              </div>
            </div>
            <div class="kr-gear-info">
              <div class="kr-gear-head">
                <h3 class="kr-gear-name">${escapeHtml(gear.name)}</h3>
                <span class="kr-gear-cost">${gear.cost === 0 ? 'STOCK' : `${formatScore(gear.cost)} C`}</span>
              </div>
              ${gear.description ? `<p class="kr-gear-desc">${escapeHtml(gear.description)}</p>` : ''}
              <div class="kr-stat-rows">
                <div class="kr-stat-row">
                  <span class="kr-stat-lbl">BOOST</span>
                  <div class="kr-stat-track"><div class="kr-stat-fill is-cyan" style="width:${boostPct.toFixed(0)}%"></div></div>
                  <span class="kr-stat-val">+${Math.round(gear.boostBonus * 100)}%</span>
                </div>
                <div class="kr-stat-row">
                  <span class="kr-stat-lbl">TURN</span>
                  <div class="kr-stat-track"><div class="kr-stat-fill is-gold" style="width:${turnPct.toFixed(0)}%"></div></div>
                  <span class="kr-stat-val">+${Math.round(gear.turnSpeedBonus * 100)}%</span>
                </div>
                <div class="kr-stat-row">
                  <span class="kr-stat-lbl">HANG</span>
                  <div class="kr-stat-track"><div class="kr-stat-fill is-mint" style="width:${hangPct.toFixed(0)}%"></div></div>
                  <span class="kr-stat-val">+${Math.round(gear.hangtimeBonus * 100)}%</span>
                </div>
              </div>
            </div>
            <div class="kr-gear-foot">${actionHtml}</div>
          </article>
        `;
      })
      .join('');

    this.shopMissionsListEl.innerHTML = this.missions
      .map((mission) => {
        const done = save.completedMissions.includes(mission.id);
        return `
          <div class="kr-mission-item ${done ? 'is-done' : ''}">
            <div class="kr-mission-check">${done ? svgIcon('check', 14) : ''}</div>
            <div class="kr-mission-body">
              <div class="kr-mission-top">
                <span class="kr-mission-title">${escapeHtml(mission.title)}</span>
                <span class="kr-mission-reward">+${formatScore(mission.rewardCoins)} C</span>
              </div>
              <p class="kr-mission-desc">${escapeHtml(mission.description)}</p>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private bindElements(): void {
    const q = <T extends HTMLElement>(sel: string): T => {
      const el = this.root.querySelector<T>(sel);
      if (!el) {
        throw new Error(`UIManager missing required element: ${sel}`);
      }
      return el;
    };

    this.hudTopEl = q('#kr-hud-top');
    this.scoreEl = q('#kr-score-val');
    this.comboWrapEl = q('#kr-combo-wrap');
    this.comboMultEl = q('#kr-combo-mult');
    this.comboPtsEl = q('#kr-combo-pts');
    this.comboFillEl = q('#kr-combo-fill');
    this.speedEl = q('#kr-speed-val');
    this.distEl = q('#kr-dist-val');
    this.coinsEl = q('#kr-coins-val');
    this.coinsPillEl = q('#kr-coins-pill');
    this.modeBadgeEl = q('#kr-mode-badge');
    this.timerEl = q('#kr-timer-val');
    this.timerWrapEl = q('#kr-timer-wrap');
    this.windValEl = q('#kr-wind-kts');

    this.btnAudioEl = q('#kr-btn-audio');
    this.btnMusicEl = q('#kr-btn-music');
    this.btnCameraEl = q('#kr-btn-camera');
    this.btnCameraLabelEl = q('#kr-btn-camera-lbl');
    this.btnAssistEl = q('#kr-btn-assist');
    this.btnAssistLabelEl = q('#kr-btn-assist-lbl');
    this.btnPauseEl = q('#kr-btn-pause');

    this.altimeterEl = q('#kr-altimeter');
    this.altValueEl = q('#kr-alt-val');
    this.hangValueEl = q('#kr-hang-val');
    this.peakValueEl = q('#kr-peak-val');
    this.altBarFillEl = q('#kr-alt-bar-fill');
    this.altRecordBadgeEl = q('#kr-alt-record');

    this.windDockEl = q('#kr-wind-dock');
    this.kiteMarkerEl = this.root.querySelector('#kr-ww-kite') as unknown as SVGGElement;
    this.kiteCanopyEl = this.root.querySelector('#kr-ww-kite-canopy') as unknown as SVGPathElement;
    this.kiteGlowEl = this.root.querySelector('#kr-ww-kite-glow') as unknown as SVGCircleElement;
    this.kiteLineLeftEl = this.root.querySelector('#kr-ww-line-l') as unknown as SVGLineElement;
    this.kiteLineRightEl = this.root.querySelector('#kr-ww-line-r') as unknown as SVGLineElement;
    this.kiteTrailPathEl = this.root.querySelector('#kr-ww-trail') as unknown as SVGPathElement;
    this.kiteLoopHaloEl = this.root.querySelector('#kr-ww-loop-halo') as unknown as SVGCircleElement;
    this.tensionFillEl = q('#kr-tension-fill');
    this.tensionPctEl = q('#kr-tension-pct');
    this.tensionStatusEl = q('#kr-tension-status');
    this.tensionMeterWrapEl = q('#kr-tension-wrap');

    this.calloutEl = q('#kr-callout');
    this.calloutTitleEl = q('#kr-callout-title');
    this.calloutSubEl = q('#kr-callout-sub');
    this.trickFeedEl = q('#kr-trick-feed');

    this.tutorialEl = q('#kr-tutorial');
    this.tutStep1El = q('#kr-tut-1');
    this.tutStep2El = q('#kr-tut-2');
    this.tutStep3El = q('#kr-tut-3');

    this.menuScreenEl = q('#kr-screen-menu');
    this.menuModesEl = q('#kr-menu-modes');
    this.menuSelectedTitleEl = q('#kr-menu-sel-title');
    this.menuSelectedDescEl = q('#kr-menu-sel-desc');
    this.menuSelectedBestEl = q('#kr-menu-sel-best');
    this.menuRecordMaxAirEl = q('#kr-rec-maxair');
    this.menuRecordCoinsEl = q('#kr-rec-coins');
    this.menuRecordMissionsEl = q('#kr-rec-missions');
    this.menuShopBadgeEl = q('#kr-menu-shop-badge');
    this.menuAudioBtnEl = q('#kr-menu-audio');
    this.menuMusicBtnEl = q('#kr-menu-music');
    this.menuAssistBtnEl = q('#kr-menu-assist');

    this.shopScreenEl = q('#kr-screen-shop');
    this.shopCoinsEl = q('#kr-shop-coins');
    this.shopEquippedEl = q('#kr-shop-equipped');
    this.shopGearGridEl = q('#kr-shop-gear-grid');
    this.shopMissionsListEl = q('#kr-shop-missions');
    this.shopMissionCountEl = q('#kr-shop-mission-count');
    this.shopTabGearBtn = q('#kr-tab-gear');
    this.shopTabMissionsBtn = q('#kr-tab-missions');
    this.shopGearPaneEl = q('#kr-pane-gear');
    this.shopMissionsPaneEl = q('#kr-pane-missions');

    this.pauseScreenEl = q('#kr-screen-pause');
    this.pauseModeEl = q('#kr-pause-mode');
    this.pauseScoreEl = q('#kr-pause-score');
    this.pauseAirEl = q('#kr-pause-air');
    this.pauseDistEl = q('#kr-pause-dist');
    this.pauseAudioBtnEl = q('#kr-pause-audio');
    this.pauseMusicBtnEl = q('#kr-pause-music');
    this.pauseAssistBtnEl = q('#kr-pause-assist');
    this.pauseCameraBtnEl = q('#kr-pause-camera');

    this.gameoverScreenEl = q('#kr-screen-gameover');
    this.goModeEl = q('#kr-go-mode');
    this.goNewBestEl = q('#kr-go-newbest');
    this.goScoreEl = q('#kr-go-score');
    this.goMaxAirEl = q('#kr-go-air');
    this.goBestComboEl = q('#kr-go-combo');
    this.goDistanceEl = q('#kr-go-dist');
    this.goTricksEl = q('#kr-go-tricks');
    this.goCoinsEl = q('#kr-go-coins');
  }

  private bindEvents(): void {
    const blurClick = (el: HTMLButtonElement, fn: () => void): void => {
      el.addEventListener('click', () => {
        el.blur();
        fn();
      });
    };

    const toggleAudio = (): void => {
      this.audioMuted = !this.audioMuted;
      this.syncToggleVisuals();
      this.callbacks.onToggleAudio(this.audioMuted);
    };
    const toggleMusic = (): void => {
      this.musicEnabled = !this.musicEnabled;
      this.syncToggleVisuals();
      this.callbacks.onToggleMusic(this.musicEnabled);
    };
    const toggleAssist = (): void => {
      this.autoAssist = !this.autoAssist;
      this.syncToggleVisuals();
      this.callbacks.onToggleAutoAssist(this.autoAssist);
    };
    const toggleCamera = (): void => {
      this.callbacks.onToggleCamera();
    };

    blurClick(this.btnAudioEl, toggleAudio);
    blurClick(this.menuAudioBtnEl, toggleAudio);
    blurClick(this.pauseAudioBtnEl, toggleAudio);

    blurClick(this.btnMusicEl, toggleMusic);
    blurClick(this.menuMusicBtnEl, toggleMusic);
    blurClick(this.pauseMusicBtnEl, toggleMusic);

    blurClick(this.btnAssistEl, toggleAssist);
    blurClick(this.menuAssistBtnEl, toggleAssist);
    blurClick(this.pauseAssistBtnEl, toggleAssist);

    blurClick(this.btnCameraEl, toggleCamera);
    blurClick(this.pauseCameraBtnEl, toggleCamera);

    blurClick(this.btnPauseEl, () => this.callbacks.onPauseToggle());

    // Tutorial dismiss
    const tutClose = this.root.querySelector<HTMLButtonElement>('#kr-tut-dismiss');
    if (tutClose) {
      blurClick(tutClose, () => {
        this.tutorialDismissed = true;
        this.tutorialEl.classList.remove('is-visible');
      });
    }

    // Menu mode cards (event delegation)
    this.menuModesEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]');
      if (!btn) return;
      btn.blur();
      const mode = btn.dataset.mode as GameMode;
      if (mode && MODE_MAP[mode]) {
        this.selectedMode = mode;
        this.renderMenuDynamic(true);
      }
    });

    // Menu PLAY & SHOP
    const playBtn = this.root.querySelector<HTMLButtonElement>('#kr-btn-play');
    if (playBtn) {
      blurClick(playBtn, () => {
        this.localShopOpen = false;
        this.resetRunUI();
        this.callbacks.onStartGame(this.selectedMode);
      });
    }

    const openShop = (returnTo: GameState): void => {
      this.shopReturnState = returnTo;
      this.localShopOpen = true;
      this.renderShopDynamic(true);
      this.applyScreenVisibility('SHOP');
      this.callbacks.onOpenShop?.();
    };

    const closeShop = (): void => {
      this.localShopOpen = false;
      this.applyScreenVisibility(this.shopReturnState);
      this.callbacks.onCloseShop?.();
    };

    const menuShopBtn = this.root.querySelector<HTMLButtonElement>('#kr-btn-open-shop');
    if (menuShopBtn) {
      blurClick(menuShopBtn, () => openShop('MENU'));
    }

    const shopCloseBtn = this.root.querySelector<HTMLButtonElement>('#kr-btn-shop-close');
    if (shopCloseBtn) {
      blurClick(shopCloseBtn, () => closeShop());
    }

    blurClick(this.shopTabGearBtn, () => {
      this.shopTab = 'GEAR';
      this.renderShopDynamic(true);
    });
    blurClick(this.shopTabMissionsBtn, () => {
      this.shopTab = 'MISSIONS';
      this.renderShopDynamic(true);
    });

    this.shopGearGridEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-gear-action]');
      if (!btn || btn.disabled) return;
      btn.blur();
      const action = btn.dataset.gearAction;
      const gearId = btn.dataset.gearId;
      if (!gearId) return;
      if (action === 'equip') {
        this.callbacks.onEquipGear(gearId);
      } else if (action === 'unlock') {
        this.callbacks.onUnlockGear(gearId);
      }
    });

    // Pause actions
    const pResume = this.root.querySelector<HTMLButtonElement>('#kr-pause-resume');
    const pRestart = this.root.querySelector<HTMLButtonElement>('#kr-pause-restart');
    const pMenu = this.root.querySelector<HTMLButtonElement>('#kr-pause-menu');
    if (pResume) blurClick(pResume, () => this.callbacks.onPauseToggle());
    if (pRestart) {
      blurClick(pRestart, () => {
        this.resetRunUI();
        this.callbacks.onRestart();
      });
    }
    if (pMenu) blurClick(pMenu, () => this.callbacks.onMainMenu());

    // Game Over actions
    const goAgain = this.root.querySelector<HTMLButtonElement>('#kr-go-again');
    const goShop = this.root.querySelector<HTMLButtonElement>('#kr-go-shop');
    const goMenu = this.root.querySelector<HTMLButtonElement>('#kr-go-menu');
    if (goAgain) {
      blurClick(goAgain, () => {
        this.resetRunUI();
        this.callbacks.onRestart();
      });
    }
    if (goShop) blurClick(goShop, () => openShop('GAME_OVER'));
    if (goMenu) blurClick(goMenu, () => this.callbacks.onMainMenu());
  }

  private buildMarkup(): string {
    return `
      <!-- TOP ARCADE HUD BAR -->
      <header id="kr-hud-top" class="kr-hud-top">
        <div class="kr-hud-cluster kr-hud-left">
          <div class="kr-glass kr-score-box">
            <span class="kr-micro-lbl">SCORE</span>
            <div id="kr-score-val" class="kr-score-val">0</div>
          </div>
          <div id="kr-combo-wrap" class="kr-glass kr-combo-box">
            <div class="kr-combo-top">
              <span id="kr-combo-mult" class="kr-combo-mult">x1</span>
              <span id="kr-combo-pts" class="kr-combo-pts">READY</span>
            </div>
            <div class="kr-combo-track">
              <div id="kr-combo-fill" class="kr-combo-fill"></div>
            </div>
          </div>
        </div>

        <div class="kr-hud-cluster kr-hud-center">
          <div class="kr-glass kr-telemetry-strip">
            <div class="kr-tel-cell">
              <span class="kr-micro-lbl">SPEED</span>
              <span class="kr-tel-num"><span id="kr-speed-val">0</span><small>kts</small></span>
            </div>
            <div class="kr-tel-div"></div>
            <div class="kr-tel-cell">
              <span class="kr-micro-lbl">DIST</span>
              <span id="kr-dist-val" class="kr-tel-num">0m</span>
            </div>
            <div class="kr-tel-div"></div>
            <div id="kr-coins-pill" class="kr-tel-cell kr-tel-coins">
              <span class="kr-micro-lbl">COINS</span>
              <span class="kr-tel-num kr-coin-row">${svgIcon('coin', 15)}<span id="kr-coins-val">0</span></span>
            </div>
            <div class="kr-tel-div"></div>
            <div id="kr-timer-wrap" class="kr-tel-cell kr-tel-timer">
              <span id="kr-mode-badge" class="kr-micro-lbl">KING OF THE AIR</span>
              <span id="kr-timer-val" class="kr-tel-num">01:30</span>
            </div>
            <div class="kr-tel-div kr-hide-sm"></div>
            <div class="kr-tel-cell kr-hide-sm">
              <span class="kr-micro-lbl">WIND</span>
              <span id="kr-wind-kts" class="kr-tel-num kr-wind-num">24 KTS</span>
            </div>
          </div>
        </div>

        <div class="kr-hud-cluster kr-hud-right">
          <div class="kr-glass kr-quick-bar">
            <button id="kr-btn-audio" type="button" class="kr-icon-btn" title="Toggle Audio SFX" aria-label="Toggle Audio SFX"></button>
            <button id="kr-btn-music" type="button" class="kr-icon-btn" title="Toggle Music" aria-label="Toggle Music"></button>
            <button id="kr-btn-camera" type="button" class="kr-pill-btn" title="Cycle Camera Angle" aria-label="Cycle Camera Angle">
              ${svgIcon('camera', 15)}<span id="kr-btn-camera-lbl">CHASE</span>
            </button>
            <button id="kr-btn-assist" type="button" class="kr-pill-btn" title="Toggle Course Pull / Free Ride" aria-label="Toggle Course Pull / Free Ride">
              ${svgIcon('assist', 15)}<span id="kr-btn-assist-lbl">FREE RIDE</span>
            </button>
            <button id="kr-btn-pause" type="button" class="kr-icon-btn kr-pause-btn" title="Pause (P / Esc)" aria-label="Pause Game">
              ${svgIcon('pause', 17)}
            </button>
          </div>
        </div>
      </header>

      <!-- INTERACTIVE 30-SECOND TUTORIAL -->
      <div id="kr-tutorial" class="kr-tutorial" aria-live="polite">
        <div class="kr-glass kr-tutorial-inner">
          <div id="kr-tut-1" class="kr-tut-step is-active">
            <span class="kr-tut-dot"></span>
            <span><strong>1.</strong> Hold <kbd>A</kbd> / <kbd>D</kbd> to dive the kite &amp; build speed</span>
          </div>
          <div id="kr-tut-2" class="kr-tut-step">
            <span class="kr-tut-dot"></span>
            <span><strong>2.</strong> Steer kite up (12 o’clock) &amp; press <kbd>SPACE</kbd> to BOOST!</span>
          </div>
          <div id="kr-tut-3" class="kr-tut-step">
            <span class="kr-tut-dot"></span>
            <span><strong>3.</strong> Press <kbd>SPACE</kbd> in mid-air for a Kiteloop &amp; <kbd>J</kbd>/<kbd>K</kbd>/<kbd>L</kbd>/<kbd>I</kbd> for Tricks!</span>
          </div>
          <button id="kr-tut-dismiss" type="button" class="kr-tut-close" aria-label="Dismiss hints">${svgIcon('close', 14)}</button>
        </div>
      </div>

      <!-- SIDE TRICK FEED -->
      <div id="kr-trick-feed" class="kr-trick-feed" aria-live="polite"></div>

      <!-- CENTER STYLE CALLOUT -->
      <div id="kr-callout" class="kr-callout" aria-live="assertive">
        <div id="kr-callout-title" class="kr-callout-title"></div>
        <div id="kr-callout-sub" class="kr-callout-sub"></div>
      </div>

      <!-- BIG AIR ALTIMETER & HANGTIME GAUGE -->
      <aside id="kr-altimeter" class="kr-glass kr-altimeter">
        <div id="kr-alt-record" class="kr-alt-record">${svgIcon('trophy', 13)}<span>NEW RECORD!</span></div>
        <div class="kr-alt-head">
          <span class="kr-micro-lbl">BIG AIR ALTIMETER</span>
        </div>
        <div class="kr-alt-body">
          <div class="kr-alt-meter">
            <div class="kr-alt-ticks">
              <span>35m</span>
              <span>25m</span>
              <span>15m</span>
              <span>5m</span>
            </div>
            <div class="kr-alt-track">
              <div id="kr-alt-bar-fill" class="kr-alt-bar-fill"></div>
            </div>
          </div>
          <div class="kr-alt-readouts">
            <div class="kr-alt-stat">
              <span class="kr-micro-lbl">ALTITUDE</span>
              <span id="kr-alt-val" class="kr-alt-big">0.0m</span>
            </div>
            <div class="kr-alt-stat">
              <span class="kr-micro-lbl">HANGTIME</span>
              <span id="kr-hang-val" class="kr-alt-med">0.0s</span>
            </div>
            <div class="kr-alt-peak-badge">
              <span class="kr-micro-lbl">PEAK JUMP</span>
              <span id="kr-peak-val" class="kr-alt-peak">0.0m</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- BOTTOM-CENTER WIND WINDOW MINI-DOME & LINE TENSION METER -->
      <section id="kr-wind-dock" class="kr-wind-dock">
        <div class="kr-glass kr-wind-card">
          <div class="kr-ww-dome-wrap">
            <svg class="kr-ww-svg" viewBox="0 0 240 132" fill="none" aria-label="Wind Window Radar">
              <defs>
                <radialGradient id="kr-ww-power-grad" cx="50%" cy="62%" r="48%">
                  <stop offset="0%" stop-color="rgba(255, 136, 0, 0.36)"/>
                  <stop offset="65%" stop-color="rgba(255, 70, 85, 0.14)"/>
                  <stop offset="100%" stop-color="rgba(255, 70, 85, 0)"/>
                </radialGradient>
                <linearGradient id="kr-ww-zenith-grad" x1="120" y1="16" x2="120" y2="54" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="rgba(0, 229, 255, 0.45)"/>
                  <stop offset="100%" stop-color="rgba(0, 229, 255, 0.04)"/>
                </linearGradient>
              </defs>

              <!-- Outer wind window hemisphere -->
              <path d="M 18 118 A 102 102 0 0 1 222 118 Z" fill="rgba(4, 14, 28, 0.58)" stroke="rgba(255,255,255,0.2)" stroke-width="1.3"/>
              <!-- Mid elevation guide arcs -->
              <path d="M 52 118 A 68 68 0 0 1 188 118" stroke="rgba(255,255,255,0.1)" stroke-width="1" stroke-dasharray="3 4"/>
              <path d="M 86 118 A 34 34 0 0 1 154 118" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="2 4"/>

              <!-- Power Zone core -->
              <ellipse cx="120" cy="84" rx="54" ry="26" fill="url(#kr-ww-power-grad)"/>
              <text x="120" y="92" text-anchor="middle" fill="rgba(255, 198, 120, 0.72)" font-size="7.5" font-weight="700" letter-spacing="1.2">POWER ZONE</text>

              <!-- 12 o'clock Zenith Boost Zone -->
              <path d="M 76 28 A 100 100 0 0 1 164 28 L 146 47 A 65 65 0 0 0 94 47 Z" fill="url(#kr-ww-zenith-grad)" stroke="rgba(0, 229, 255, 0.52)" stroke-width="1"/>
              <text x="120" y="29" text-anchor="middle" fill="#90F4FF" font-size="7.5" font-weight="800" letter-spacing="1">12:00 BOOST</text>

              <!-- Clock tick spokes -->
              <line x1="120" y1="16" x2="120" y2="24" stroke="#00E5FF" stroke-width="1.6"/>
              <line x1="65" y1="34" x2="70" y2="41" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>
              <line x1="175" y1="34" x2="170" y2="41" stroke="rgba(255,255,255,0.28)" stroke-width="1.2"/>

              <!-- Motion trail -->
              <path id="kr-ww-trail" d="" stroke="rgba(0, 229, 255, 0.55)" stroke-width="2" stroke-linecap="round" fill="none"/>

              <!-- Dynamic lines from rider bar -->
              <line id="kr-ww-line-l" x1="117" y1="118" x2="112" y2="45" stroke="rgba(230, 248, 255, 0.5)" stroke-width="1.1"/>
              <line id="kr-ww-line-r" x1="123" y1="118" x2="128" y2="45" stroke="rgba(230, 248, 255, 0.5)" stroke-width="1.1"/>

              <!-- Rider anchor bar -->
              <rect x="111" y="116" width="18" height="4" rx="2" fill="#E6F8FF" opacity="0.85"/>

              <!-- Live Kite Marker -->
              <g id="kr-ww-kite" transform="translate(120 45)">
                <circle id="kr-ww-loop-halo" cx="0" cy="0" r="14" stroke="#FF4D6D" stroke-width="2" stroke-dasharray="4 3" opacity="0"/>
                <circle id="kr-ww-kite-glow" cx="0" cy="0" r="10" fill="rgba(0, 229, 255, 0.22)"/>
                <path id="kr-ww-kite-canopy" d="M -10 3 C -6 -6, 6 -6, 10 3 L 7 5 C 4 -1, -4 -1, -7 5 Z" fill="#00E5FF" stroke="#FFFFFF" stroke-width="1.2"/>
              </g>
            </svg>
          </div>

          <div id="kr-tension-wrap" class="kr-tension-wrap">
            <div class="kr-tension-head">
              <span id="kr-tension-status" class="kr-tension-status">LINE TENSION</span>
              <span id="kr-tension-pct" class="kr-tension-pct">0%</span>
            </div>
            <div class="kr-tension-track">
              <div id="kr-tension-fill" class="kr-tension-fill"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- TITLE SCREEN (MENU) OVER LIVE 3D OCEAN FLYOVER -->
      <main id="kr-screen-menu" class="kr-screen kr-screen-menu is-visible">
        <div class="kr-menu-topbar">
          <div class="kr-brand-lockup">
            <div class="kr-brand-eyebrow">
              ${svgIcon('wind', 15)}<span>TRADE WINDS • 24 KTS • OPEN SWELL</span>
            </div>
            <h1 class="kr-brand-title">KITE RUSH <span class="kr-brand-accent">BIG AIR</span></h1>
          </div>

          <div class="kr-menu-top-right">
            <div class="kr-glass kr-records-bar">
              <div class="kr-rec-item">
                <span class="kr-micro-lbl">MAX AIR RECORD</span>
                <span id="kr-rec-maxair" class="kr-rec-val">0.0m</span>
              </div>
              <div class="kr-tel-div"></div>
              <div class="kr-rec-item">
                <span class="kr-micro-lbl">COINS</span>
                <span class="kr-rec-val kr-coin-row">${svgIcon('coin', 15)}<span id="kr-rec-coins">0</span></span>
              </div>
              <div class="kr-tel-div"></div>
              <div class="kr-rec-item">
                <span class="kr-micro-lbl">MISSIONS</span>
                <span id="kr-rec-missions" class="kr-rec-val">0/8</span>
              </div>
            </div>

            <div class="kr-menu-audio-row">
              <button id="kr-menu-assist" type="button" class="kr-glass kr-mini-toggle" title="Toggle Course Pull Helper vs Free Ride" aria-label="Toggle Course Pull / Free Ride"></button>
              <button id="kr-menu-audio" type="button" class="kr-glass kr-mini-toggle"></button>
              <button id="kr-menu-music" type="button" class="kr-glass kr-mini-toggle"></button>
            </div>
          </div>
        </div>

        <div class="kr-menu-dock">
          <div class="kr-menu-left">
            <div id="kr-menu-modes" class="kr-mode-grid"></div>
            <div class="kr-glass kr-controls-strip">
              <div class="kr-ctrl-item"><kbd>A</kbd><kbd>D</kbd><span>Steer Kite &amp; Carve</span></div>
              <div class="kr-ctrl-item"><kbd>W</kbd><kbd>S</kbd><span>Bar Sheet / Edge</span></div>
              <div class="kr-ctrl-item"><kbd>SPACE</kbd><span>Jump (Water) / Kiteloop (Air)</span></div>
              <div class="kr-ctrl-item"><kbd>SHIFT</kbd><kbd>E</kbd><span>Alt Kiteloop</span></div>
              <div class="kr-ctrl-item"><kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>I</kbd><span>Mid-Air Tricks</span></div>
              <div class="kr-ctrl-item"><kbd>C</kbd><span>Cycle Camera (Chase / POV / Pro / Heli)</span></div>
              <div class="kr-ctrl-item"><kbd>P</kbd><kbd>ESC</kbd><span>Pause</span></div>
            </div>
          </div>

          <aside class="kr-glass kr-menu-cta-panel">
            <div class="kr-cta-info">
              <span class="kr-micro-lbl">SELECTED EVENT</span>
              <h2 id="kr-menu-sel-title" class="kr-cta-title">King of the Air</h2>
              <p id="kr-menu-sel-desc" class="kr-cta-desc"></p>
              <div class="kr-cta-best-row">
                <span class="kr-micro-lbl">EVENT RECORD</span>
                <span id="kr-menu-sel-best" class="kr-cta-best-val">0</span>
              </div>
            </div>
            <div class="kr-cta-buttons">
              <button id="kr-btn-play" type="button" class="kr-btn-primary">
                ${svgIcon('play', 18)}<span>PLAY NOW</span>
              </button>
              <button id="kr-btn-open-shop" type="button" class="kr-btn-secondary">
                ${svgIcon('shop', 17)}<span>GEAR SHOP</span>
                <span id="kr-menu-shop-badge" class="kr-shop-badge">0 COINS</span>
              </button>
            </div>
          </aside>
        </div>
      </main>

      <!-- GEAR SHOP & MISSIONS MODAL -->
      <section id="kr-screen-shop" class="kr-screen kr-modal-backdrop" role="dialog" aria-modal="true" aria-label="Gear Shop and Missions">
        <div class="kr-glass kr-shop-modal">
          <div class="kr-shop-header">
            <div class="kr-shop-title-group">
              <h2 class="kr-modal-title">KITE HANGAR &amp; MISSIONS</h2>
              <div class="kr-shop-sub">
                <span>Equipped:</span>
                <strong id="kr-shop-equipped">Tradewind Classic</strong>
              </div>
            </div>

            <div class="kr-shop-header-right">
              <div class="kr-coin-pill">
                ${svgIcon('coin', 17)}
                <span id="kr-shop-coins">0</span>
                <small>COINS</small>
              </div>
              <button id="kr-btn-shop-close" type="button" class="kr-btn-close" aria-label="Close Gear Shop">
                ${svgIcon('close', 18)}<span>BACK</span>
              </button>
            </div>
          </div>

          <div class="kr-shop-tabs">
            <button id="kr-tab-gear" type="button" class="kr-tab-btn is-active">KITES &amp; BOARDS</button>
            <button id="kr-tab-missions" type="button" class="kr-tab-btn">MISSIONS <span id="kr-shop-mission-count">0/8</span></button>
          </div>

          <div class="kr-shop-body">
            <div id="kr-pane-gear" class="kr-shop-gear-pane is-mobile-active">
              <div id="kr-shop-gear-grid" class="kr-gear-grid"></div>
            </div>
            <aside id="kr-pane-missions" class="kr-shop-missions-pane">
              <div class="kr-missions-head">
                ${svgIcon('trophy', 16)}
                <span>SEASON MISSIONS</span>
              </div>
              <div id="kr-shop-missions" class="kr-missions-list"></div>
            </aside>
          </div>
        </div>
      </section>

      <!-- PAUSE OVERLAY -->
      <section id="kr-screen-pause" class="kr-screen kr-modal-backdrop" role="dialog" aria-modal="true" aria-label="Game Paused">
        <div class="kr-glass kr-center-card">
          <span class="kr-micro-lbl">SESSION PAUSED</span>
          <h2 id="kr-pause-mode" class="kr-modal-title">KING OF THE AIR</h2>
          <div class="kr-summary-mini">
            <div class="kr-sum-mini-cell">
              <span class="kr-micro-lbl">SCORE</span>
              <span id="kr-pause-score" class="kr-sum-mini-val">0</span>
            </div>
            <div class="kr-sum-mini-cell">
              <span class="kr-micro-lbl">PEAK AIR</span>
              <span id="kr-pause-air" class="kr-sum-mini-val">0.0m</span>
            </div>
            <div class="kr-sum-mini-cell">
              <span class="kr-micro-lbl">DISTANCE</span>
              <span id="kr-pause-dist" class="kr-sum-mini-val">0m</span>
            </div>
          </div>

          <div class="kr-pause-toggles">
            <button id="kr-pause-audio" type="button" class="kr-toggle-tile"></button>
            <button id="kr-pause-music" type="button" class="kr-toggle-tile"></button>
            <button id="kr-pause-assist" type="button" class="kr-toggle-tile"></button>
            <button id="kr-pause-camera" type="button" class="kr-toggle-tile"></button>
          </div>

          <div class="kr-modal-actions">
            <button id="kr-pause-resume" type="button" class="kr-btn-primary">${svgIcon('play', 17)}<span>RESUME</span></button>
            <button id="kr-pause-restart" type="button" class="kr-btn-secondary">${svgIcon('restart', 17)}<span>RESTART HEAT</span></button>
            <button id="kr-pause-menu" type="button" class="kr-btn-ghost">${svgIcon('home', 17)}<span>CHANGE MODE / MENU</span></button>
          </div>
        </div>
      </section>

      <!-- POST-HEAT / GAME OVER SUMMARY CARD -->
      <section id="kr-screen-gameover" class="kr-screen kr-modal-backdrop" role="dialog" aria-modal="true" aria-label="Heat Results">
        <div class="kr-glass kr-center-card kr-gameover-card">
          <div class="kr-go-head">
            <span id="kr-go-mode" class="kr-micro-lbl">KING OF THE AIR</span>
            <span id="kr-go-newbest" class="kr-newbest-pill">${svgIcon('trophy', 14)}<span>NEW BEST!</span></span>
          </div>
          <h2 class="kr-modal-title">HEAT COMPLETE</h2>
          <div class="kr-go-score-wrap">
            <span class="kr-micro-lbl">FINAL SCORE</span>
            <div id="kr-go-score" class="kr-go-score">0</div>
          </div>

          <div class="kr-go-grid">
            <div class="kr-go-stat">
              <span class="kr-micro-lbl">MAX JUMP HEIGHT</span>
              <span id="kr-go-air" class="kr-go-val">0.0m</span>
            </div>
            <div class="kr-go-stat">
              <span class="kr-micro-lbl">BEST COMBO</span>
              <span id="kr-go-combo" class="kr-go-val">x1</span>
            </div>
            <div class="kr-go-stat">
              <span class="kr-micro-lbl">DISTANCE</span>
              <span id="kr-go-dist" class="kr-go-val">0m</span>
            </div>
            <div class="kr-go-stat">
              <span class="kr-micro-lbl">TRICKS LANDED</span>
              <span id="kr-go-tricks" class="kr-go-val">0</span>
            </div>
            <div class="kr-go-stat kr-go-stat-coins">
              <span class="kr-micro-lbl">COINS EARNED</span>
              <span id="kr-go-coins" class="kr-go-val kr-gold-text">+0</span>
            </div>
          </div>

          <div class="kr-modal-actions">
            <button id="kr-go-again" type="button" class="kr-btn-primary">${svgIcon('restart', 17)}<span>PLAY AGAIN</span></button>
            <div class="kr-modal-subactions">
              <button id="kr-go-shop" type="button" class="kr-btn-secondary">${svgIcon('shop', 16)}<span>GEAR SHOP</span></button>
              <button id="kr-go-menu" type="button" class="kr-btn-ghost">${svgIcon('home', 16)}<span>MENU</span></button>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 40;
        pointer-events: none;
        user-select: none;
        font-family: 'Avenir Next', 'SF Pro Display', 'Segoe UI', system-ui, -apple-system, sans-serif;
        color: #F4F9FF;
        overflow: hidden;
        --kr-bg: rgba(7, 17, 32, 0.74);
        --kr-bg-deep: rgba(6, 14, 27, 0.88);
        --kr-border: rgba(186, 226, 255, 0.16);
        --kr-cyan: #00E5FF;
        --kr-gold: #FFD43B;
        --kr-coral: #FF3B5C;
        --kr-mint: #1AF29B;
        --kr-muted: #98B6D1;
      }

      #${ROOT_ID}, #${ROOT_ID} * {
        box-sizing: border-box;
      }

      #${ROOT_ID} button {
        font-family: inherit;
        cursor: pointer;
        border: none;
        color: inherit;
      }

      #${ROOT_ID} button:focus-visible {
        outline: 2px solid var(--kr-cyan);
        outline-offset: 2px;
      }

      #${ROOT_ID} kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 21px;
        padding: 0 6px;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-bottom-width: 2px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.03em;
        color: #FFFFFF;
      }

      .kr-glass {
        background: var(--kr-bg);
        backdrop-filter: blur(14px) saturate(155%);
        -webkit-backdrop-filter: blur(14px) saturate(155%);
        border: 1px solid var(--kr-border);
        box-shadow: 0 12px 32px rgba(2, 8, 20, 0.36);
      }

      .kr-micro-lbl {
        display: block;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--kr-muted);
        line-height: 1.1;
      }

      .kr-coin-row {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--kr-gold);
      }

      /* TOP HUD BAR */
      .kr-hud-top {
        position: absolute;
        top: 14px;
        left: 18px;
        right: 18px;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        opacity: 0;
        transform: translateY(-16px);
        transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .kr-hud-top.is-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .kr-hud-cluster {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .kr-hud-right {
        pointer-events: auto;
      }

      .kr-score-box {
        padding: 8px 16px;
        border-radius: 14px;
        min-width: 128px;
      }
      .kr-score-val {
        font-size: 26px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        line-height: 1.1;
        margin-top: 2px;
      }

      .kr-combo-box {
        padding: 8px 14px;
        border-radius: 14px;
        min-width: 148px;
        opacity: 0.72;
        transition: opacity 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }
      .kr-combo-box.is-active {
        opacity: 1;
        border-color: rgba(0, 229, 255, 0.55);
      }
      .kr-combo-box.is-urgent {
        border-color: rgba(255, 59, 92, 0.75);
        animation: kr-pulse-soft 0.55s ease-in-out infinite alternate;
      }
      .kr-combo-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .kr-combo-mult {
        font-size: 22px;
        font-weight: 900;
        font-style: italic;
        font-variant-numeric: tabular-nums;
        color: var(--kr-cyan);
        line-height: 1;
      }
      .kr-combo-pts {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: #E7F5FF;
        max-width: 116px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .kr-combo-track {
        height: 4px;
        margin-top: 6px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
      }
      .kr-combo-fill {
        width: 100%;
        height: 100%;
        transform-origin: left center;
        transform: scaleX(0);
        background: linear-gradient(90deg, var(--kr-cyan), var(--kr-gold));
        border-radius: 99px;
      }

      .kr-telemetry-strip {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 8px 16px;
        border-radius: 14px;
      }
      .kr-tel-cell {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
      }
      .kr-tel-num {
        font-size: 18px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
      .kr-tel-num small {
        font-size: 11px;
        font-weight: 700;
        color: var(--kr-muted);
        margin-left: 2px;
      }
      .kr-wind-num {
        color: var(--kr-cyan);
      }
      .kr-tel-div {
        width: 1px;
        height: 26px;
        background: rgba(255, 255, 255, 0.14);
      }
      .kr-tel-coins.is-pop {
        animation: kr-pop-bump 0.32s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .kr-tel-timer.is-urgent .kr-tel-num {
        color: var(--kr-coral);
        animation: kr-pulse-soft 0.48s ease-in-out infinite alternate;
      }

      .kr-quick-bar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px;
        border-radius: 14px;
      }
      .kr-icon-btn, .kr-pill-btn {
        height: 34px;
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.08);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease;
      }
      .kr-icon-btn {
        width: 34px;
      }
      .kr-pill-btn {
        padding: 0 10px;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.06em;
      }
      .kr-icon-btn:hover, .kr-pill-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        transform: translateY(-1px);
      }
      .kr-icon-btn.is-off {
        color: var(--kr-muted);
        background: rgba(255, 255, 255, 0.04);
      }
      .kr-pill-btn.is-active {
        background: rgba(0, 229, 255, 0.2);
        color: #9BF5FF;
        box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.45);
      }
      .kr-pause-btn {
        background: rgba(255, 255, 255, 0.13);
      }
      .kr-icon-btn > *,
      .kr-pill-btn > *,
      .kr-mini-toggle > *,
      .kr-toggle-tile > *,
      .kr-pause-opt-btn > * {
        pointer-events: none;
      }

      /* TUTORIAL PROMPTS */
      .kr-tutorial {
        position: absolute;
        top: 82px;
        left: 50%;
        max-width: min(580px, calc(100vw - 32px));
        transform: translate(-50%, -10px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .kr-tutorial.is-visible {
        opacity: 1;
        transform: translate(-50%, 0);
        pointer-events: auto;
      }
      .kr-tutorial-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 8px 14px;
        border-radius: 999px;
        font-size: 12.5px;
      }
      .kr-tut-step {
        display: none;
        align-items: center;
        gap: 8px;
        color: #FFFFFF;
        white-space: nowrap;
      }
      .kr-tut-step.is-active {
        display: flex;
      }
      .kr-tut-step.is-done {
        color: var(--kr-mint);
      }
      .kr-tut-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--kr-cyan);
        box-shadow: 0 0 8px rgba(0, 229, 255, 0.8);
        flex-shrink: 0;
      }
      .kr-tut-step.is-done .kr-tut-dot {
        background: var(--kr-mint);
        box-shadow: 0 0 8px rgba(26, 242, 155, 0.8);
      }
      .kr-tut-close {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--kr-muted);
      }
      .kr-tut-close:hover {
        background: rgba(255, 255, 255, 0.2);
        color: #FFFFFF;
      }

      /* SIDE TRICK FEED */
      .kr-trick-feed {
        position: absolute;
        top: 94px;
        left: 18px;
        display: flex;
        flex-direction: column;
        gap: 7px;
        width: 260px;
      }
      .kr-feed-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 12px;
        border-radius: 10px;
        background: rgba(7, 18, 34, 0.78);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        animation: kr-feed-in 0.24s cubic-bezier(0.16, 1, 0.3, 1);
        transition: opacity 0.25s ease, transform 0.25s ease;
      }
      .kr-feed-item.is-fading {
        opacity: 0;
        transform: translateX(-14px);
      }
      .kr-feed-pts {
        font-variant-numeric: tabular-nums;
        color: var(--kr-cyan);
      }
      .kr-feed-boost .kr-feed-pts { color: var(--kr-gold); }
      .kr-feed-record .kr-feed-pts { color: var(--kr-gold); }
      .kr-feed-landing .kr-feed-pts { color: var(--kr-mint); }
      .kr-feed-wipeout { border-color: rgba(255, 59, 92, 0.55); }
      .kr-feed-wipeout .kr-feed-pts { color: var(--kr-coral); }

      /* CENTER STYLE CALLOUT */
      .kr-callout {
        position: absolute;
        top: 22%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.86);
        text-align: center;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
        text-shadow: 0 6px 24px rgba(0, 8, 22, 0.75);
      }
      .kr-callout.is-visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
      .kr-callout-title {
        font-size: clamp(24px, 3.2vw, 38px);
        font-weight: 900;
        font-style: italic;
        letter-spacing: -0.02em;
        text-transform: uppercase;
        color: #FFFFFF;
        line-height: 1.05;
      }
      .kr-callout[data-variant="boost"] .kr-callout-title { color: var(--kr-gold); }
      .kr-callout[data-variant="record"] .kr-callout-title { color: var(--kr-gold); }
      .kr-callout[data-variant="landing"] .kr-callout-title { color: var(--kr-mint); }
      .kr-callout[data-variant="wipeout"] .kr-callout-title { color: var(--kr-coral); }
      .kr-callout[data-variant="trick"] .kr-callout-title { color: var(--kr-cyan); }
      .kr-callout-sub {
        display: inline-block;
        margin-top: 6px;
        padding: 4px 12px;
        border-radius: 999px;
        background: rgba(6, 16, 30, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.2);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #F4F9FF;
      }

      /* BIG AIR ALTIMETER */
      .kr-altimeter {
        position: absolute;
        right: 20px;
        top: 50%;
        transform: translate(24px, -50%) scale(0.95);
        opacity: 0;
        border-radius: 18px;
        padding: 14px 16px;
        width: 196px;
        transition: opacity 0.22s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
      }
      .kr-altimeter.is-visible {
        opacity: 1;
        transform: translate(0, -50%) scale(1);
      }
      .kr-altimeter.is-record {
        border-color: rgba(255, 212, 59, 0.78);
        box-shadow: 0 12px 32px rgba(255, 212, 59, 0.22);
      }
      .kr-alt-record {
        display: none;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 4px 9px;
        margin-bottom: 10px;
        border-radius: 999px;
        background: linear-gradient(90deg, #FFB800, #FFE066);
        color: #0A1424;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.09em;
        animation: kr-pulse-soft 0.55s ease-in-out infinite alternate;
      }
      .kr-alt-record.is-visible {
        display: flex;
      }
      .kr-alt-head {
        margin-bottom: 10px;
      }
      .kr-alt-body {
        display: flex;
        align-items: stretch;
        gap: 12px;
      }
      .kr-alt-meter {
        display: flex;
        align-items: stretch;
        gap: 5px;
      }
      .kr-alt-ticks {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        font-size: 9px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        color: var(--kr-muted);
        padding: 2px 0;
      }
      .kr-alt-track {
        width: 10px;
        height: 132px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
        position: relative;
      }
      .kr-alt-bar-fill {
        position: absolute;
        inset: 0;
        transform-origin: bottom center;
        transform: scaleY(0.05);
        border-radius: 99px;
        background: linear-gradient(0deg, var(--kr-cyan) 0%, var(--kr-mint) 55%, var(--kr-gold) 100%);
      }
      .kr-alt-readouts {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 8px;
      }
      .kr-alt-big {
        display: block;
        font-size: 28px;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        color: #FFFFFF;
        margin-top: 3px;
      }
      .kr-alt-med {
        display: block;
        font-size: 20px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-cyan);
        margin-top: 2px;
      }
      .kr-alt-peak-badge {
        padding: 6px 8px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.07);
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      .kr-alt-peak {
        display: block;
        font-size: 14px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-gold);
        margin-top: 2px;
      }

      /* WIND WINDOW MINI-DOME & LINE TENSION */
      .kr-wind-dock {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translate(-50%, 16px);
        opacity: 0;
        transition: opacity 0.25s ease, transform 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .kr-wind-dock.is-visible {
        opacity: 1;
        transform: translate(-50%, 0);
      }
      .kr-wind-card {
        border-radius: 16px;
        padding: 8px 12px;
        width: 320px;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .kr-ww-dome-wrap {
        width: 156px;
        flex-shrink: 0;
      }
      .kr-ww-svg {
        display: block;
        width: 100%;
        height: auto;
      }
      .kr-tension-wrap {
        flex: 1;
        min-width: 0;
        padding-left: 12px;
        border-left: 1px solid rgba(255, 255, 255, 0.14);
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
      }
      .kr-tension-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .kr-tension-status {
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0.08em;
        color: var(--kr-muted);
        line-height: 1.2;
      }
      .kr-tension-pct {
        font-size: 13px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: #FFFFFF;
      }
      .kr-tension-track {
        height: 10px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.11);
        overflow: hidden;
      }
      .kr-tension-fill {
        width: 100%;
        height: 100%;
        transform-origin: left center;
        transform: scaleX(0);
        border-radius: 99px;
        background: linear-gradient(90deg, #0095FF 0%, var(--kr-cyan) 62%, var(--kr-gold) 100%);
        transition: filter 0.15s ease;
      }
      .kr-tension-wrap.is-primed .kr-tension-status,
      .kr-tension-wrap.is-zenith .kr-tension-status {
        color: var(--kr-gold);
        animation: kr-pulse-soft 0.45s ease-in-out infinite alternate;
      }
      .kr-tension-wrap.is-primed .kr-tension-fill {
        filter: drop-shadow(0 0 8px rgba(255, 212, 59, 0.8));
      }
      .kr-tension-wrap.is-looping .kr-tension-status {
        color: var(--kr-coral);
      }

      /* FULLSCREEN OVERLAY SCREENS */
      .kr-screen {
        position: absolute;
        inset: 0;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.26s ease;
      }
      .kr-screen.is-visible {
        opacity: 1;
        pointer-events: auto;
      }

      /* TITLE SCREEN (MENU) */
      .kr-screen-menu {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 20px 26px 18px;
        background: linear-gradient(180deg, rgba(4, 13, 27, 0.54) 0%, rgba(4, 13, 27, 0.06) 36%, rgba(4, 13, 27, 0.1) 62%, rgba(4, 13, 27, 0.7) 100%);
      }
      .kr-menu-topbar {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
      }
      .kr-brand-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 5px 11px;
        border-radius: 999px;
        background: rgba(6, 18, 36, 0.7);
        border: 1px solid rgba(0, 229, 255, 0.35);
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.12em;
        color: #93F3FF;
      }
      .kr-brand-title {
        margin: 10px 0 0;
        font-size: clamp(34px, 4.4vw, 56px);
        font-weight: 900;
        font-style: italic;
        letter-spacing: -0.03em;
        line-height: 0.96;
        text-shadow: 0 8px 28px rgba(3, 10, 24, 0.65);
      }
      .kr-brand-accent {
        color: var(--kr-cyan);
      }

      .kr-menu-top-right {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 10px;
      }
      .kr-records-bar {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 10px 18px;
        border-radius: 14px;
      }
      .kr-rec-item {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .kr-rec-val {
        font-size: 17px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .kr-menu-audio-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }
      .kr-mini-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 12px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .kr-mini-toggle.is-active {
        background: rgba(0, 229, 255, 0.2);
        border-color: rgba(0, 229, 255, 0.45);
        color: #9BF5FF;
      }
      .kr-mini-toggle.is-off {
        color: var(--kr-muted);
      }

      .kr-menu-dock {
        display: grid;
        grid-template-columns: 1fr 310px;
        gap: 16px;
        align-items: end;
      }
      .kr-menu-left {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 0;
      }
      .kr-mode-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .kr-mode-card {
        text-align: left;
        padding: 11px 12px;
        border-radius: 14px;
        background: rgba(7, 18, 35, 0.78);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 6px;
        transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
      }
      .kr-mode-card:hover {
        transform: translateY(-2px);
        border-color: rgba(0, 229, 255, 0.48);
        background: rgba(11, 26, 48, 0.86);
      }
      .kr-mode-card.is-selected {
        background: rgba(9, 29, 54, 0.92);
        border-color: var(--kr-cyan);
        box-shadow: 0 10px 28px rgba(0, 229, 255, 0.22);
      }
      .kr-mode-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .kr-mode-name {
        font-size: 14px;
        font-weight: 800;
        letter-spacing: -0.01em;
      }
      .kr-mode-pill {
        padding: 3px 7px;
        border-radius: 999px;
        background: rgba(0, 229, 255, 0.16);
        color: #8CF3FF;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.08em;
        white-space: nowrap;
      }
      .kr-mode-card.is-selected .kr-mode-pill {
        background: var(--kr-cyan);
        color: #061324;
      }
      .kr-mode-copy {
        margin: 0;
        font-size: 11.5px;
        line-height: 1.38;
        color: var(--kr-muted);
      }
      .kr-mode-foot {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        padding-top: 6px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }
      .kr-mode-best-lbl {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: var(--kr-muted);
      }
      .kr-mode-best-val {
        font-size: 14px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-gold);
      }

      .kr-controls-strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px 18px;
        padding: 10px 16px;
        border-radius: 14px;
      }
      .kr-ctrl-item {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11.5px;
        font-weight: 600;
        color: #D4E6F8;
      }

      .kr-menu-cta-panel {
        border-radius: 18px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 14px;
        background: var(--kr-bg-deep);
      }
      .kr-cta-title {
        margin: 4px 0 6px;
        font-size: 22px;
        font-weight: 900;
        font-style: italic;
        letter-spacing: -0.02em;
      }
      .kr-cta-desc {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.42;
        color: var(--kr-muted);
      }
      .kr-cta-best-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255, 255, 255, 0.12);
      }
      .kr-cta-best-val {
        font-size: 18px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-gold);
      }
      .kr-cta-buttons {
        display: flex;
        flex-direction: column;
        gap: 9px;
      }

      .kr-btn-primary, .kr-btn-secondary, .kr-btn-ghost {
        width: 100%;
        height: 46px;
        border-radius: 12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        transition: transform 0.15s ease, filter 0.15s ease, background 0.15s ease;
      }
      .kr-btn-primary {
        background: linear-gradient(135deg, #00E5FF 0%, #14B8FF 55%, #00FFBF 100%);
        color: #051324;
        box-shadow: 0 8px 24px rgba(0, 229, 255, 0.35);
      }
      .kr-btn-primary:hover {
        transform: translateY(-1px);
        filter: brightness(1.07);
      }
      .kr-btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      .kr-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.17);
      }
      .kr-btn-ghost {
        background: rgba(255, 255, 255, 0.05);
        color: var(--kr-muted);
      }
      .kr-btn-ghost:hover {
        background: rgba(255, 255, 255, 0.11);
        color: #FFFFFF;
      }
      .kr-shop-badge {
        margin-left: auto;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(255, 212, 59, 0.16);
        color: var(--kr-gold);
        font-size: 10px;
        font-weight: 800;
      }
      .kr-shop-badge.is-ready {
        background: var(--kr-gold);
        color: #091322;
      }

      /* MODALS (SHOP, PAUSE, GAME OVER) */
      .kr-modal-backdrop {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(3, 10, 22, 0.56);
        backdrop-filter: blur(8px);
      }
      .kr-modal-title {
        margin: 4px 0 0;
        font-size: 26px;
        font-weight: 900;
        font-style: italic;
        letter-spacing: -0.02em;
      }

      /* GEAR SHOP */
      .kr-shop-modal {
        width: min(1080px, 100%);
        max-height: min(740px, 92vh);
        border-radius: 22px;
        padding: 20px 22px;
        background: rgba(7, 17, 33, 0.92);
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .kr-shop-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding-bottom: 14px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      }
      .kr-shop-sub {
        margin-top: 4px;
        font-size: 12px;
        color: var(--kr-muted);
      }
      .kr-shop-sub strong {
        color: var(--kr-cyan);
      }
      .kr-shop-header-right {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .kr-coin-pill {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 8px 14px;
        border-radius: 999px;
        background: rgba(255, 212, 59, 0.14);
        border: 1px solid rgba(255, 212, 59, 0.4);
        font-size: 16px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-gold);
      }
      .kr-coin-pill small {
        font-size: 10px;
        letter-spacing: 0.08em;
      }
      .kr-btn-close {
        height: 38px;
        padding: 0 14px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.1);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .kr-btn-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      .kr-shop-tabs {
        display: none;
        gap: 8px;
      }
      .kr-tab-btn {
        flex: 1;
        height: 36px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.07);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--kr-muted);
      }
      .kr-tab-btn.is-active {
        background: rgba(0, 229, 255, 0.2);
        color: #FFFFFF;
        box-shadow: inset 0 0 0 1px rgba(0, 229, 255, 0.5);
      }

      .kr-shop-body {
        display: grid;
        grid-template-columns: 1fr 310px;
        gap: 18px;
        min-height: 0;
        overflow: hidden;
      }
      .kr-shop-gear-pane, .kr-shop-missions-pane {
        overflow-y: auto;
        padding-right: 4px;
        scrollbar-width: thin;
        scrollbar-color: rgba(0, 229, 255, 0.4) transparent;
      }
      .kr-shop-gear-pane::-webkit-scrollbar,
      .kr-shop-missions-pane::-webkit-scrollbar {
        width: 6px;
      }
      .kr-shop-gear-pane::-webkit-scrollbar-thumb,
      .kr-shop-missions-pane::-webkit-scrollbar-thumb {
        background: rgba(0, 229, 255, 0.35);
        border-radius: 99px;
      }

      .kr-gear-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .kr-gear-card {
        border-radius: 16px;
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.045);
        border: 1px solid rgba(255, 255, 255, 0.12);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .kr-gear-card.is-equipped {
        background: rgba(0, 229, 255, 0.08);
        border-color: rgba(0, 229, 255, 0.58);
      }
      .kr-gear-preview {
        position: relative;
        height: 82px;
        border-radius: 11px;
        background: radial-gradient(circle at 50% 30%, rgba(30, 82, 130, 0.38), rgba(4, 12, 24, 0.72));
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .kr-gear-svg {
        width: 146px;
        height: 78px;
      }
      .kr-swatches {
        position: absolute;
        top: 8px;
        right: 8px;
        display: flex;
        gap: 4px;
      }
      .kr-swatch {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.55);
      }
      .kr-gear-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
      }
      .kr-gear-name {
        margin: 0;
        font-size: 15px;
        font-weight: 800;
      }
      .kr-gear-cost {
        font-size: 11px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-gold);
      }
      .kr-gear-desc {
        margin: 4px 0 8px;
        font-size: 11.5px;
        line-height: 1.35;
        color: var(--kr-muted);
      }
      .kr-stat-rows {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .kr-stat-row {
        display: grid;
        grid-template-columns: 44px 1fr 36px;
        align-items: center;
        gap: 8px;
      }
      .kr-stat-lbl {
        font-size: 9.5px;
        font-weight: 800;
        letter-spacing: 0.08em;
        color: var(--kr-muted);
      }
      .kr-stat-track {
        height: 6px;
        border-radius: 99px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
      }
      .kr-stat-fill {
        height: 100%;
        border-radius: 99px;
      }
      .kr-stat-fill.is-cyan { background: var(--kr-cyan); }
      .kr-stat-fill.is-gold { background: var(--kr-gold); }
      .kr-stat-fill.is-mint { background: var(--kr-mint); }
      .kr-stat-val {
        text-align: right;
        font-size: 11px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: #E7F5FF;
      }
      .kr-gear-btn {
        width: 100%;
        height: 36px;
        border-radius: 9px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 11.5px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .kr-gear-btn.is-equipped {
        background: rgba(0, 229, 255, 0.22);
        color: #9FF6FF;
        cursor: default;
      }
      .kr-gear-btn.is-equip {
        background: rgba(255, 255, 255, 0.14);
      }
      .kr-gear-btn.is-equip:hover {
        background: rgba(255, 255, 255, 0.24);
      }
      .kr-gear-btn.is-unlock {
        background: linear-gradient(135deg, #FFD43B, #FFA900);
        color: #091322;
      }
      .kr-gear-btn.is-unlock:hover {
        filter: brightness(1.08);
      }
      .kr-gear-btn.is-locked {
        background: rgba(255, 255, 255, 0.06);
        color: var(--kr-muted);
        cursor: not-allowed;
      }

      /* MISSIONS PANEL */
      .kr-shop-missions-pane {
        background: rgba(255, 255, 255, 0.035);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        padding: 14px;
      }
      .kr-missions-head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.1em;
        color: var(--kr-gold);
        margin-bottom: 12px;
      }
      .kr-missions-list {
        display: flex;
        flex-direction: column;
        gap: 9px;
      }
      .kr-mission-item {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .kr-mission-item.is-done {
        background: rgba(26, 242, 155, 0.08);
        border-color: rgba(26, 242, 155, 0.35);
      }
      .kr-mission-check {
        width: 20px;
        height: 20px;
        border-radius: 6px;
        border: 1.5px solid rgba(255, 255, 255, 0.25);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 1px;
      }
      .kr-mission-item.is-done .kr-mission-check {
        background: var(--kr-mint);
        border-color: var(--kr-mint);
        color: #051814;
      }
      .kr-mission-body {
        flex: 1;
        min-width: 0;
      }
      .kr-mission-top {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }
      .kr-mission-title {
        font-size: 12.5px;
        font-weight: 800;
      }
      .kr-mission-reward {
        font-size: 11px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
        color: var(--kr-gold);
        white-space: nowrap;
      }
      .kr-mission-desc {
        margin: 3px 0 0;
        font-size: 11px;
        line-height: 1.35;
        color: var(--kr-muted);
      }

      /* PAUSE & GAME OVER CENTER CARDS */
      .kr-center-card {
        width: min(460px, 100%);
        border-radius: 22px;
        padding: 24px;
        background: rgba(7, 17, 33, 0.92);
        display: flex;
        flex-direction: column;
        gap: 16px;
        text-align: center;
      }
      .kr-summary-mini {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
      }
      .kr-sum-mini-val {
        display: block;
        margin-top: 4px;
        font-size: 18px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .kr-pause-toggles {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .kr-toggle-tile {
        height: 38px;
        padding: 0 12px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        font-size: 11.5px;
        font-weight: 700;
      }
      .kr-toggle-tile:hover {
        background: rgba(255, 255, 255, 0.15);
      }
      .kr-modal-actions {
        display: flex;
        flex-direction: column;
        gap: 9px;
      }
      .kr-modal-subactions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
      }

      .kr-gameover-card {
        width: min(500px, 100%);
      }
      .kr-go-head {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
      }
      .kr-newbest-pill {
        display: none;
        align-items: center;
        gap: 5px;
        padding: 3px 10px;
        border-radius: 999px;
        background: linear-gradient(90deg, #FFB800, #FFE066);
        color: #081322;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.08em;
      }
      .kr-newbest-pill.is-visible {
        display: inline-flex;
      }
      .kr-go-score-wrap {
        padding: 12px;
        border-radius: 14px;
        background: rgba(0, 229, 255, 0.08);
        border: 1px solid rgba(0, 229, 255, 0.28);
      }
      .kr-go-score {
        margin-top: 4px;
        font-size: 42px;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
        line-height: 1;
        color: #FFFFFF;
      }
      .kr-go-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      .kr-go-stat {
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.09);
      }
      .kr-go-stat-coins {
        grid-column: span 2;
      }
      .kr-go-val {
        display: block;
        margin-top: 4px;
        font-size: 20px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .kr-gold-text {
        color: var(--kr-gold);
      }

      /* ANIMATIONS */
      @keyframes kr-pulse-soft {
        from { transform: scale(1); filter: brightness(1); }
        to { transform: scale(1.03); filter: brightness(1.16); }
      }
      @keyframes kr-pop-bump {
        0% { transform: scale(1); }
        45% { transform: scale(1.16); }
        100% { transform: scale(1); }
      }
      @keyframes kr-feed-in {
        from { opacity: 0; transform: translateX(-18px); }
        to { opacity: 1; transform: translateX(0); }
      }

      /* RESPONSIVE */
      @media (max-width: 1040px) {
        .kr-menu-dock {
          grid-template-columns: 1fr;
        }
        .kr-mode-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 860px) {
        .kr-hud-top {
          flex-wrap: wrap;
          top: 10px;
          left: 10px;
          right: 10px;
        }
        .kr-hud-center {
          order: 3;
          width: 100%;
          justify-content: center;
        }
        .kr-hide-sm {
          display: none;
        }
        .kr-tutorial {
          top: 122px;
        }
        .kr-tutorial-inner {
          border-radius: 14px;
          gap: 8px;
        }
        .kr-tut-step {
          white-space: normal;
        }
        .kr-shop-tabs {
          display: flex;
        }
        .kr-shop-body {
          grid-template-columns: 1fr;
        }
        .kr-shop-gear-pane, .kr-shop-missions-pane {
          display: none;
        }
        .kr-shop-gear-pane.is-mobile-active, .kr-shop-missions-pane.is-mobile-active {
          display: block;
        }
      }
      @media (max-width: 600px) {
        .kr-screen-menu {
          padding: 14px;
          overflow-y: auto;
        }
        .kr-menu-topbar {
          flex-direction: column;
        }
        .kr-menu-top-right {
          align-items: flex-start;
        }
        .kr-mode-grid, .kr-gear-grid {
          grid-template-columns: 1fr;
        }
        .kr-wind-dock {
          bottom: 148px;
        }
        .kr-wind-card {
          width: 262px;
          padding: 7px 10px;
          gap: 9px;
        }
        .kr-ww-dome-wrap {
          width: 124px;
        }
        .kr-altimeter {
          right: 10px;
          width: 162px;
          padding: 10px 12px;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        #${ROOT_ID} * {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
    `;
    document.head.appendChild(style);
  }
}
