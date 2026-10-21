/**
 * 鲸鱼娘宠物插件类型声明。
 *
 * 这份文件不参与运行——插件产物是纯 JS——但 IDE 会读它：
 *   - VS Code / WebStorm 的智能提示与跳转
 *   - JSDoc @typedef 引用（见 lib/src/config.js 顶部）
 *   - tsc --noEmit 的类型检查（可选）
 */

/** 配置项（DEFAULTS 的形状）。 */
export interface PetConfig {
  enabled: boolean;
  comboWindowMs: number;
  maxCombo: number;
  minFood: number;
  maxFood: number;
  tokensPerFood: number;
  foodPerDouble: number;
  hungerRegenPerMin: number;
  manualFeedEnabled: boolean;
  manualFeedFood: number;
  manualFeedExp: number;
  manualSnackMax: number;
  manualSnackRegenMs: number;
  hungryAt: number;
  vitalsEnabled: boolean;
  moodPerFeed: number;
  moodPerPat: number;
  moodDecayPerMin: number;
  moodDropPerMinHungry: number;
  moodCrashPerMinStarving: number;
  moodExpFreezeAt: number;
  moodExpSwing: number;
  moodSadAt: number;
  energyPerFeed: number;
  energyRegenPerMin: number;
  energySleepFactor: number;
  lowEnergyAt: number;
  tiredExpFactor: number;
  sleepEnabled: boolean;
  sleepAfterMs: number;
  sleepHungerFactor: number;
  patEnabled: boolean;
  patCooldownMs: number;
  miniGameEnabled: boolean;
  miniGameCooldownMs: number;
  miniGameTargets: number;
  miniGameTimeoutMs: number;
  miniGameExpReward: number;
  miniGameSnackReward: number;
  miniGameMoodReward: number;
  bubbleEnabled: boolean;
  bubbleTtlMs: number;
  bubbleMinGapMs: number;
  dynamicLinesEvery: number;
  dragEnabled: boolean;
  achievementsEnabled: boolean;
  achievementSnacks: number;
  dailyEnabled: boolean;
  dailyQuestExp: number;
  dailyQuestSnacks: number;
  pickyEnabled: boolean;
  favoriteSource: string;
  favoriteBonus: number;
  boredomAfter: number;
  boredomFactor: number;
  frenzyEnabled: boolean;
  frenzyMs: number;
  frenzyExpFactor: number;
  frenzyFoodFactor: number;
  eggDropEnabled: boolean;
  eggDropBaseChance: number;
  eggDropComboBonus: number;
  skillsEnabled: boolean;
  skillXpPerLevel: number;
  skillMaxLevel: number;
  masteryXpPerTier: number;
  evolveEnabled: boolean;
  evolveMinLevel: number;
  evolveMinSkillLevel: number;
  prestigeEnabled: boolean;
  prestigeMinLevel: number;
  prestigeExpBonus: number;
  memoryEnabled: boolean;
  memoryFileTop: number;
  adviceEnabled: boolean;
  adviceMinSkillLevel: number;
  adviceCooldownMs: number;
  adviceRepeatEditAt: number;
  adviceErrorStreakAt: number;
  careEnabled: boolean;
  careCooldownMs: number;
  careNightFrom: number;
  careNightTo: number;
  careMarathonMs: number;
  careComebackMs: number;
  moodDimsEnabled: boolean;
  curiosityPerNew: number;
  curiosityPerResearch: number;
  pridePerWin: number;
  pridePerLevelup: number;
  concernPerError: number;
  concernPerWorry: number;
  moodDimDecayPerMin: number;
  moodDimAt: number;
  eyeTrackEnabled: boolean;
  eyeTrackMax: number;
  eyeTrackIdleMs: number;
  idleActEnabled: boolean;
  idleActEveryMs: number;
  idleActQuietMs: number;
  idleActMs: number;
  /** 鲸鱼头像的默认画法：矢量 Q 版 / APNG 立绘。 */
  avatarStyle: "svg" | "sprite";
  effectsEnabled: boolean;
  effectTtlMs: number;
  flyFromConversation: boolean;
  freshnessMs: number;
  persist: boolean;
  saveDebounceMs: number;
  offlineRegenCapMs: number;
  petName: string;
  petSpecies: string;
  petAvatar: string;
  petIcon: string;
}

/** 宠物核心状态。 */
export interface PetState {
  name: string;
  species: string;
  avatar: string;
  icon: string;
  mood: number;
  hunger: number;
  energy: number;
  curiosity: number;
  pride: number;
  concern: number;
  exp: number;
  level: number;
  form: string;
}

/** 技能记录。 */
export interface SkillRecord {
  xp: number;
  level: number;
  mastery: number;
}

/** 技能表（四条技能）。 */
export interface Skills {
  coding: SkillRecord;
  research: SkillRecord;
  debug: SkillRecord;
  writing: SkillRecord;
}

/** 记忆行（文件 / 工具各一份）。 */
export interface MemoryRow {
  name: string;
  count: number;
}

/** 宠物记忆。 */
export interface PetMemory {
  files: MemoryRow[];
  tools: MemoryRow[];
  hours: number[];
  bornDay: number;
  errors: number;
  recoveries: number;
}

/** 每日任务进度。 */
export interface DailyProgress {
  day: number;
  feeds: number;
  tools: number;
  bestCombo: number;
  pats: number;
  tokens: number;
  snacks: number;
  done: string[];
}

/** 台词气泡。 */
export interface Bubble {
  key: string;
  kind: string;
  text: string;
}

/** 限时 BUFF（暴食等）。 */
export interface Buff {
  kind: string;
  until: number;
}

/** 飞行起点。 */
export interface Flight {
  dx: number;
  dy: number;
  across: boolean;
}

/** 一条特效（食物飞入 + 飘字）。 */
export interface FeedEffectData {
  key: string;
  icon: string;
  text?: string;
  foodAmount: number;
  expAmount: number;
  tokens: number;
  foodTier: string;
  source: string;
  comboCount: number;
  comboMultiplier: number;
  tier: string;
  flight: Flight;
}

/** 蛋。 */
export interface Egg {
  id: string;
  type: string;
  obtainedAt: number;
}

/** 蛋类型定义。 */
export interface EggType {
  key: string;
  label: string;
  icon: string;
  shell: string;
  species: string;
}

/** 微游戏目标。 */
export interface MiniGameTarget {
  id: number;
  icon: string;
  x: number;
  y: number;
  caught: boolean;
}

/** 微游戏状态。 */
export interface MiniGame {
  targets: MiniGameTarget[];
  current: number;
  startedAt: number;
  deadline: number;
  score: number;
  finished: boolean;
  success: boolean;
}

/** token 来源统计。 */
export interface TokensBySource {
  user_input: number;
  generation: number;
  tool_result: number;
}

/** 卡片位移。 */
export interface Pos {
  dx: number;
  dy: number;
}

/** 顶层 UI 状态（store.getState() 的返回类型）。 */
export interface StoreState {
  pet: PetState;
  effects: FeedEffectData[];
  comboCount: number;
  comboMultiplier: number;
  comboTier: string;
  eatKey: number;
  patKey: number;
  lastAct: string | null;
  idleAct: string | null;
  totalFeeds: number;
  totalTokens: number;
  tokensBySource: TokensBySource;
  snacks: number;
  achievements: string[];
  daily: DailyProgress;
  streakDay: number;
  streakCount: number;
  pats: number;
  skills: Skills;
  memory: PetMemory;
  pos: Pos;
  lastFeedAt: number;
  asleep: boolean;
  bubble: Bubble | null;
  buff: Buff | null;
  panelOpen: boolean;
  dragging: boolean;
  activePetId: string;
  petCount: number;
  favorites: string[];
  eggs: Egg[];
  petOrder: string[];
  eggPanelOpen: boolean;
  hatchingEgg: Egg | null;
  addPetOpen: boolean;
  miniGame: MiniGame | null;
  prestige: number;
  talent: string;
  /** 当前头像画法（偏好键优先，其次配置）。 */
  avatarStyle: "svg" | "sprite";
  /** 立绘 chunk 是否已经到了（没到时立绘画法画的是空 img）。 */
  spritesReady: boolean;
  cardDataUrl: string | null;
}

/** 成就定义。 */
export interface Achievement {
  id: string;
  icon: string;
  label: string;
  hint: string;
  test: (stats: any, config: PetConfig) => boolean;
}

/** 每日任务定义。 */
export interface DailyQuest {
  id: string;
  icon: string;
  label: string;
  goal: number;
  of: (daily: DailyProgress) => number;
}

/** 种族属性。 */
export interface SpeciesInfo {
  name: string;
  icon: string;
  avatar: string;
  label: string;
  talent: string;
  hungerBonus: number;
  skillBonus: Partial<Record<keyof Skills, number>> | null;
}

/** 蛋里程碑。 */
export interface EggMilestone {
  id: string;
  egg: string;
  test: (global: GlobalStats) => boolean;
}

/** 全局统计（跨宠物）。 */
export interface GlobalStats {
  totalTokensAllTime: number;
  totalFeedsAllTime: number;
  achievementsUnlockedAllTime: number;
  petsHatched: number;
  eggsObtained: string[];
}

/** 宠物存档记录（collection 里的一份）。 */
export interface PetRecord {
  id: string;
  species: string;
  name: string;
  avatar: string;
  icon: string;
  bornAt: number;
  pet: {
    hunger: number;
    mood: number;
    energy: number;
    curiosity: number;
    pride: number;
    concern: number;
    exp: number;
    level: number;
    form: string;
  };
  totalFeeds: number;
  totalTokens: number;
  tokensBySource: TokensBySource;
  snacks: number;
  achievements: string[];
  daily: DailyProgress;
  streakDay: number;
  streakCount: number;
  pats: number;
  pos: Pos;
  lastFeedAt: number;
  skills: Skills;
  memory: PetMemory;
  prestige: number;
}

/** tool/call 观察结果。 */
export interface ToolCallInfo {
  callId: string;
  name: string;
  file: string | null;
}

/** tool/result 观察结果。 */
export interface ToolResultInfo {
  callId: string;
  failed: boolean;
}

/** Store API（createPetStore 的返回类型）。 */
export interface PetStore {
  getState(): StoreState;
  subscribe(listener: () => void): () => void;
  tick(): void;
  feed(source: string, tokens: number, now: number, output: number): void;
  observeTool(call: ToolCallInfo, now: number): void;
  observeToolResult(result: ToolResultInfo, now: number): void;
  snack(): boolean;
  pat(): boolean;
  togglePanel(): void;
  beginDrag(x: number, y: number): void;
  moveDrag(x: number, y: number): void;
  endDrag(): void;
  dragged(): boolean;
  switchPet(direction: number): void;
  /** 矢量 ⇄ 立绘，偏好写进 dsh-pet-plugin/avatar-style。 */
  toggleAvatarStyle(): void;
  toggleFavorite(): void;
  openEggPanel(): void;
  startHatch(eggId: string): void;
  cancelHatch(): void;
  confirmHatch(name: string): boolean;
  checkEggMilestones(): Egg[];
  addPet(speciesKey: string, name: string): boolean;
  openAddPet(): void;
  renamePet(name: string): boolean;
  getCollection(): Record<string, PetRecord>;
  getEggs(): Egg[];
  getGlobalStats(): GlobalStats;
  isFavorite(): boolean;
  startMiniGame(): boolean;
  hitMiniGameTarget(targetId: number): void;
  failMiniGame(): void;
  generateCard(): void;
  dismissCard(): void;
  prestige(): boolean;
  dispose(): void;
}

/** FeedGate API。 */
export interface FeedGate {
  admit(event: any): boolean;
}

/** 形态长相描述（lookOf 的返回类型）。 */
export interface Look {
  key: string;
  label: string;
  aria: string;
  size: number;
  skin: string[];
  line: string;
  lineWidth: number;
  eyeGrow: number;
  art: any;
  spout: boolean;
  dorsal: boolean;
  crown: boolean;
  nextLabel: string | null;
  nextLevel: number | null;
}
