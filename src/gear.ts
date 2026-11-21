import { GameMode, KiteGear, MissionDef, PlayerSaveData } from './types';

export const GEAR_CATALOG: KiteGear[] = [
  {
    id: 'tradewind-classic',
    name: 'Tradewind Classic',
    description: 'Balanced freeride delta kite and twin-tip board built for smooth tradewind sessions.',
    kiteColorPrimary: '#00d4ff',
    kiteColorSecondary: '#ffffff',
    boardColor: '#0b2545',
    boostBonus: 0.0,
    turnSpeedBonus: 0.0,
    hangtimeBonus: 0.0,
    cost: 0,
  },
  {
    id: 'coral-surge',
    name: 'Coral Surge 10M',
    description: 'Snappy C-kite profile with responsive bar feedback for rapid carves and early loops.',
    kiteColorPrimary: '#ff5e3a',
    kiteColorSecondary: '#ffd166',
    boardColor: '#ff7b54',
    boostBonus: 0.08,
    turnSpeedBonus: 0.12,
    hangtimeBonus: 0.05,
    cost: 120,
  },
  {
    id: 'lagoon-pro',
    name: 'Emerald Reef Pro',
    description: 'High-aspect canopy tuned for effortless glide, floaty hangtime, and soft landings.',
    kiteColorPrimary: '#00f5a0',
    kiteColorSecondary: '#00d9f5',
    boardColor: '#0f4c5c',
    boostBonus: 0.14,
    turnSpeedBonus: 0.14,
    hangtimeBonus: 0.18,
    cost: 260,
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare 9M',
    description: 'Explosive power-zone booster engineered for violent vertical pops off steep swells.',
    kiteColorPrimary: '#ffbe0b',
    kiteColorSecondary: '#fb5607',
    boardColor: '#2b2d42',
    boostBonus: 0.24,
    turnSpeedBonus: 0.18,
    hangtimeBonus: 0.20,
    cost: 480,
  },
  {
    id: 'neon-vortex',
    name: 'Neon Vortex Carbon',
    description: 'Featherweight bridle freestyle machine built for fast rotations and late handlepasses.',
    kiteColorPrimary: '#ff007f',
    kiteColorSecondary: '#00f0ff',
    boardColor: '#1a0b2e',
    boostBonus: 0.26,
    turnSpeedBonus: 0.30,
    hangtimeBonus: 0.24,
    cost: 750,
  },
  {
    id: 'storm-chaser',
    name: 'Tempest Carbon X',
    description: 'Five-strut storm weapon built to charge 40-knot squalls and commit to massive megaloops.',
    kiteColorPrimary: '#7b2cbf',
    kiteColorSecondary: '#38b6ff',
    boardColor: '#111827',
    boostBonus: 0.34,
    turnSpeedBonus: 0.30,
    hangtimeBonus: 0.34,
    cost: 1100,
  },
  {
    id: 'king-apex',
    name: 'King of the Air Apex',
    description: 'Championship gold-halo rig delivering peak boost, razor turns, and endless hangtime.',
    kiteColorPrimary: '#ffd700',
    kiteColorSecondary: '#141418',
    boardColor: '#d4af37',
    boostBonus: 0.40,
    turnSpeedBonus: 0.40,
    hangtimeBonus: 0.40,
    cost: 1600,
  },
];

export const MISSIONS_CATALOG: MissionDef[] = [
  {
    id: 'first-flight',
    title: 'First Flight',
    description: 'Reach 10m altitude in a single Big Air jump.',
    rewardCoins: 40,
  },
  {
    id: 'big-air-20m',
    title: 'Reach 20m Big Air',
    description: 'Send the kite to 12 o’clock and boost above 20m.',
    rewardCoins: 100,
  },
  {
    id: 'big-air-30m',
    title: 'Stratosphere King',
    description: 'Launch an enormous 30m+ Big Air jump.',
    rewardCoins: 200,
  },
  {
    id: 'mega-kiteloop',
    title: 'Land a Mega Kiteloop',
    description: 'Pull a full mid-air kiteloop and ride away clean.',
    rewardCoins: 120,
  },
  {
    id: 'collect-50-coins',
    title: 'Collect 50 Coins',
    description: 'Hold or collect 50 golden Kite-Coins.',
    rewardCoins: 80,
  },
  {
    id: 'sky-rings-3',
    title: 'Pass 3 Sky Rings',
    description: 'Thread through 3 Aerial Sky-Rings in a single run.',
    rewardCoins: 110,
  },
  {
    id: 'combo-5x',
    title: 'Style Maestro',
    description: 'Build and land a 5x trick combo multiplier.',
    rewardCoins: 130,
  },
  {
    id: 'slalom-gates-10',
    title: 'Buoy Blazer',
    description: 'Carve cleanly through 10 Slalom gates in one session.',
    rewardCoins: 120,
  },
];

export interface MissionProgressStats {
  maxJumpHeight?: number;
  landedMegaKiteloop?: boolean;
  coinsEarnedThisRun?: number;
  ringsPassedThisRun?: number;
  bestCombo?: number;
  gatesClearedThisRun?: number;
}

const DEFAULT_STORAGE_KEY = 'kite_rush_big_air_save_v1';
const DEFAULT_GEAR_ID = GEAR_CATALOG[0].id;

export function getGearById(gearId: string): KiteGear {
  return GEAR_CATALOG.find((g) => g.id === gearId) ?? GEAR_CATALOG[0];
}

function createDefaultSaveData(): PlayerSaveData {
  return {
    highScores: {
      ENDLESS: 0,
      BIG_AIR: 0,
      FREESTYLE: 0,
      SLALOM: 0,
    },
    maxHeightRecord: 0,
    coins: 0,
    unlockedGear: [DEFAULT_GEAR_ID],
    equippedGear: DEFAULT_GEAR_ID,
    completedMissions: [],
  };
}

function sanitizeSaveData(raw: unknown): PlayerSaveData {
  const fallback = createDefaultSaveData();
  if (!raw || typeof raw !== 'object') {
    return fallback;
  }

  const obj = raw as Partial<PlayerSaveData>;
  const validGearIds = new Set(GEAR_CATALOG.map((g) => g.id));
  const validMissionIds = new Set(MISSIONS_CATALOG.map((m) => m.id));

  const modes: GameMode[] = ['ENDLESS', 'BIG_AIR', 'FREESTYLE', 'SLALOM'];
  const highScores: Record<GameMode, number> = { ...fallback.highScores };
  if (obj.highScores && typeof obj.highScores === 'object') {
    for (const mode of modes) {
      const val = (obj.highScores as Record<string, unknown>)[mode];
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
        highScores[mode] = Math.floor(val);
      }
    }
  }

  const unlockedSet = new Set<string>([DEFAULT_GEAR_ID]);
  if (Array.isArray(obj.unlockedGear)) {
    for (const id of obj.unlockedGear) {
      if (typeof id === 'string' && validGearIds.has(id)) {
        unlockedSet.add(id);
      }
    }
  }

  const equippedGear =
    typeof obj.equippedGear === 'string' && unlockedSet.has(obj.equippedGear)
      ? obj.equippedGear
      : DEFAULT_GEAR_ID;

  const completedSet = new Set<string>();
  if (Array.isArray(obj.completedMissions)) {
    for (const id of obj.completedMissions) {
      if (typeof id === 'string' && validMissionIds.has(id)) {
        completedSet.add(id);
      }
    }
  }

  return {
    highScores,
    maxHeightRecord:
      typeof obj.maxHeightRecord === 'number' && Number.isFinite(obj.maxHeightRecord) && obj.maxHeightRecord >= 0
        ? obj.maxHeightRecord
        : 0,
    coins:
      typeof obj.coins === 'number' && Number.isFinite(obj.coins) && obj.coins >= 0
        ? Math.floor(obj.coins)
        : 0,
    unlockedGear: Array.from(unlockedSet),
    equippedGear,
    completedMissions: Array.from(completedSet),
  };
}

export class SaveManager {
  private readonly storageKey: string;
  private data: PlayerSaveData;

  constructor(storageKey: string = DEFAULT_STORAGE_KEY) {
    this.storageKey = storageKey;
    this.data = this.load();
  }

  private getStorage(): Storage | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage;
      }
    } catch {
      return null;
    }
    return null;
  }

  public load(): PlayerSaveData {
    const storage = this.getStorage();
    if (!storage) {
      return createDefaultSaveData();
    }
    try {
      const raw = storage.getItem(this.storageKey);
      if (!raw) {
        return createDefaultSaveData();
      }
      return sanitizeSaveData(JSON.parse(raw));
    } catch {
      return createDefaultSaveData();
    }
  }

  public save(): void {
    const storage = this.getStorage();
    if (!storage) return;
    try {
      storage.setItem(this.storageKey, JSON.stringify(this.data));
    } catch {
      // Ignore quota or private mode storage errors safely
    }
  }

  public getData(): PlayerSaveData {
    return {
      highScores: { ...this.data.highScores },
      maxHeightRecord: this.data.maxHeightRecord,
      coins: this.data.coins,
      unlockedGear: [...this.data.unlockedGear],
      equippedGear: this.data.equippedGear,
      completedMissions: [...this.data.completedMissions],
    };
  }

  public reset(): PlayerSaveData {
    this.data = createDefaultSaveData();
    this.save();
    return this.getData();
  }

  public getEquippedGear(): KiteGear {
    return getGearById(this.data.equippedGear);
  }

  public isGearUnlocked(gearId: string): boolean {
    return this.data.unlockedGear.includes(gearId);
  }

  public canAffordGear(gearId: string): boolean {
    const gear = GEAR_CATALOG.find((g) => g.id === gearId);
    if (!gear) return false;
    return this.data.coins >= gear.cost;
  }

  public equipGear(gearId: string): boolean {
    if (!this.isGearUnlocked(gearId)) return false;
    const exists = GEAR_CATALOG.some((g) => g.id === gearId);
    if (!exists) return false;
    this.data.equippedGear = gearId;
    this.save();
    return true;
  }

  public unlockGear(gearId: string): boolean {
    const gear = GEAR_CATALOG.find((g) => g.id === gearId);
    if (!gear) return false;
    if (this.isGearUnlocked(gearId)) {
      return this.equipGear(gearId);
    }
    if (this.data.coins < gear.cost) {
      return false;
    }
    this.data.coins -= gear.cost;
    this.data.unlockedGear.push(gearId);
    this.data.equippedGear = gearId;
    this.save();
    return true;
  }

  public addCoins(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
      return this.data.coins;
    }
    this.data.coins += Math.floor(amount);
    this.save();
    return this.data.coins;
  }

  public recordRun(params: {
    mode: GameMode;
    score: number;
    maxJumpHeight: number;
    coinsEarned?: number;
  }): { isNewBest: boolean; isNewHeightRecord: boolean } {
    const cleanScore = Math.max(0, Math.floor(params.score));
    const cleanHeight = Math.max(0, params.maxJumpHeight);

    const prevBest = this.data.highScores[params.mode] ?? 0;
    const isNewBest = cleanScore > prevBest;
    if (isNewBest) {
      this.data.highScores[params.mode] = cleanScore;
    }

    const isNewHeightRecord = cleanHeight > this.data.maxHeightRecord;
    if (isNewHeightRecord) {
      this.data.maxHeightRecord = Math.round(cleanHeight * 10) / 10;
    }

    if (params.coinsEarned && params.coinsEarned > 0) {
      this.data.coins += Math.floor(params.coinsEarned);
    }

    this.save();
    return { isNewBest, isNewHeightRecord };
  }

  public isMissionCompleted(missionId: string): boolean {
    return this.data.completedMissions.includes(missionId);
  }

  public completeMission(missionId: string): MissionDef | null {
    if (this.isMissionCompleted(missionId)) return null;
    const mission = MISSIONS_CATALOG.find((m) => m.id === missionId);
    if (!mission) return null;
    this.data.completedMissions.push(missionId);
    this.data.coins += mission.rewardCoins;
    this.save();
    return mission;
  }

  public evaluateMissions(stats: MissionProgressStats): MissionDef[] {
    const newlyCompleted: MissionDef[] = [];
    const check = (id: string, condition: boolean): void => {
      if (condition && !this.isMissionCompleted(id)) {
        const completed = this.completeMission(id);
        if (completed) newlyCompleted.push(completed);
      }
    };

    const maxH = stats.maxJumpHeight ?? 0;
    check('first-flight', maxH >= 10);
    check('big-air-20m', maxH >= 20);
    check('big-air-30m', maxH >= 30);
    check('mega-kiteloop', Boolean(stats.landedMegaKiteloop));
    check('collect-50-coins', this.data.coins >= 50 || (stats.coinsEarnedThisRun ?? 0) >= 50);
    check('sky-rings-3', (stats.ringsPassedThisRun ?? 0) >= 3);
    check('combo-5x', (stats.bestCombo ?? 0) >= 5);
    check('slalom-gates-10', (stats.gatesClearedThisRun ?? 0) >= 10);

    return newlyCompleted;
  }
}
