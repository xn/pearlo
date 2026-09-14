/**
 * Fake `kolmafia` module, substituted for the real package by the vitest alias in
 * vitest.config.ts. Everything reads from and writes to a single mutable game state
 * (`__state`), which tests configure through test/support/harness.ts. Only the surface
 * src actually imports is implemented; add functions here as src grows.
 *
 * The classes are identity-cached per name (like mafia's), so `Item.get("pec oil")`
 * is `===` across the whole module graph of one test.
 */

// ---------- fake game object model ----------

let nextId = 1;

export class MafiaClass {
  readonly name: string;
  readonly id: number;
  constructor(name: string) {
    this.name = name;
    this.id = nextId++;
  }
  toString(): string {
    return this.name;
  }
}

function makeRegistry<T extends MafiaClass>(cls: new (name: string) => T) {
  const registry = new Map<string, T>();
  return (name: string): T => {
    const key = name.toLowerCase();
    const existing = registry.get(key);
    if (existing) return existing;
    const created = new cls(name);
    registry.set(key, created);
    return created;
  };
}

export class Item extends MafiaClass {
  static readonly registry = new Map<string, Item>();
  static get(name: string): Item {
    const key = name.toLowerCase();
    const existing = Item.registry.get(key);
    if (existing) return existing;
    const created = new Item(name);
    Item.registry.set(key, created);
    return created;
  }
  get tradeable(): boolean {
    return !__state.untradeable.has(this);
  }
  get dailyusesleft(): number {
    return __state.itemDailyUses.get(this) ?? 0;
  }
  static get none(): Item {
    return Item.get("none");
  }
}

export class Effect extends MafiaClass {
  private static readonly lookup = makeRegistry(Effect);
  static get(name: string): Effect {
    return Effect.lookup(name);
  }
  static all(): Effect[] {
    return [];
  }
  get all(): string[] {
    return __state.effectDefaultActions.get(this) ?? [];
  }
  get default(): string | undefined {
    return this.all[0];
  }
  static get none(): Effect {
    return Effect.get("none");
  }
}

export class Familiar extends MafiaClass {
  private static readonly lookup = makeRegistry(Familiar);
  static get(name: string): Familiar {
    return Familiar.lookup(name);
  }
  get underwater(): boolean {
    return __state.underwaterFamiliars.has(this);
  }
  static get none(): Familiar {
    return Familiar.get("none");
  }
}

export class Skill extends MafiaClass {
  private static readonly lookup = makeRegistry(Skill);
  static get(name: string): Skill {
    return Skill.lookup(name);
  }
  static get none(): Skill {
    return Skill.get("none");
  }
}

export class Location extends MafiaClass {
  private static readonly lookup = makeRegistry(Location);
  static get(name: string): Location {
    return Location.lookup(name);
  }
}

export class Monster extends MafiaClass {
  private static readonly lookup = makeRegistry(Monster);
  static get(name: string): Monster {
    return Monster.lookup(name);
  }
}

export class Element extends MafiaClass {
  private static readonly lookup = makeRegistry(Element);
  static get(name: string): Element {
    return Element.lookup(name);
  }
}

export class Stat extends MafiaClass {
  private static readonly lookup = makeRegistry(Stat);
  static get(name: string): Stat {
    return Stat.lookup(name);
  }
}

export class Class extends MafiaClass {
  private static readonly lookup = makeRegistry(Class);
  static get(name: string): Class {
    return Class.lookup(name);
  }
}

const SLOT_NAMES = [
  "hat",
  "back",
  "shirt",
  "weapon",
  "off-hand",
  "pants",
  "acc1",
  "acc2",
  "acc3",
  "familiar",
];

export class Slot extends MafiaClass {
  private static readonly lookup = makeRegistry(Slot);
  static get(name: string): Slot {
    return Slot.lookup(name);
  }
  static all(): Slot[] {
    return SLOT_NAMES.map((s) => Slot.get(s));
  }
}

// ---------- mutable game state ----------

export type BuyCall = { item: Item; count: number; limit: number | undefined };
export type UseCall = { item: Item; count: number };

export type GameState = {
  properties: Map<string, unknown>;
  inventory: Map<Item, number>;
  effects: Map<Effect, number>;
  mallPrices: Map<Item, number>;
  /** Days since each stored mall price was read. Unset reads as never priced. */
  mallPriceAges: Map<Item, number>;
  /** What a live mall search changes, keyed by item. */
  mallSearchHandlers: Map<Item, () => void>;
  npcPrices: Map<Item, number>;
  historicalPrices: Map<Item, number>;
  /** garbo-lib value() and libram getSaleValue() both read this. */
  saleValues: Map<Item, number>;
  itemMods: Map<Item, Record<string, number>>;
  itemEffects: Map<Item, Effect>;
  itemSlots: Map<Item, Slot>;
  itemDailyUses: Map<Item, number>;
  untradeable: Set<Item>;
  unequippable: Set<Item>;
  /** Called when an outfit is dressed, so a test can change what the player measures. */
  onDress?: (spec: unknown) => void;
  effectMods: Map<Effect, Record<string, number>>;
  effectDefaultActions: Map<Effect, string[]>;
  skillMpCosts: Map<Skill, number>;
  skillHpCosts: Map<Skill, number>;
  playerMods: Record<string, number | boolean>;
  /** What numericModifier("Generated:_spec", …) reports after a speculative maximize. */
  specMods: Record<string, number | boolean>;
  /** Return value of maximize(); tests may replace maximizeImpl wholesale. */
  maximizeReturn: boolean;
  maximizeImpl: (modifier: string, speculate: boolean) => boolean;
  buffedStats: Record<string, number>;
  familiarsOwned: Set<Familiar>;
  underwaterFamiliars: Set<Familiar>;
  skillsKnown: Set<Skill>;
  currentFamiliar: Familiar;
  familiarWeights: Map<Familiar, number>;
  weightAdjustment: number;
  /** numericModifier(familiar, resName, weight, equip) for weight-scaled familiars. */
  familiarModImpl: (familiar: Familiar, modifier: string, weight: number, equip: Item) => number;
  equipped: Map<Slot, Item>;
  outfits: Map<string, Item[]>;
  workshed: Item;
  adventures: number;
  turncount: number;
  meat: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  fullness: number;
  fullnessLimit: number;
  inebriety: number;
  inebrietyLimit: number;
  spleenUse: number;
  spleenLimit: number;
  playerClass: Class;
  blockedLocations: Set<Location>;
  /** What buy() actually delivers; the default fills whenever the cap covers mall price. */
  buyImpl: (item: Item, count: number, limit: number | undefined) => number;
  makeValueThrows: boolean;
  /** Side effects a CLI command has in the fake game, keyed by the exact command. */
  cliHandlers: Map<string, () => void>;
  log: {
    buys: BuyCall[];
    uses: UseCall[];
    cliExecutes: string[];
    mallSearches: { item: Item; maxAge: number }[];
    skillsCast: Skill[];
    hpRestores: number[];
    mpRestores: number[];
    prints: string[];
    maximizes: { modifier: string; speculate: boolean }[];
    retrieves: Item[];
  };
};

function freshState(): GameState {
  const state: GameState = {
    properties: new Map(),
    inventory: new Map(),
    effects: new Map(),
    mallPrices: new Map(),
    mallPriceAges: new Map(),
    mallSearchHandlers: new Map(),
    npcPrices: new Map(),
    historicalPrices: new Map(),
    saleValues: new Map(),
    itemMods: new Map(),
    itemEffects: new Map(),
    itemSlots: new Map(),
    itemDailyUses: new Map(),
    untradeable: new Set(),
    unequippable: new Set(),
    onDress: undefined,
    effectMods: new Map(),
    effectDefaultActions: new Map(),
    skillMpCosts: new Map(),
    skillHpCosts: new Map(),
    playerMods: {},
    specMods: {},
    maximizeReturn: true,
    maximizeImpl: (modifier, speculate) => {
      state.log.maximizes.push({ modifier, speculate });
      return state.maximizeReturn;
    },
    buffedStats: { Muscle: 1000, Mysticality: 2000, Moxie: 2000 },
    familiarsOwned: new Set(),
    underwaterFamiliars: new Set(),
    skillsKnown: new Set(),
    currentFamiliar: Familiar.none,
    familiarWeights: new Map(),
    weightAdjustment: 0,
    familiarModImpl: () => 0,
    equipped: new Map(),
    outfits: new Map(),
    workshed: Item.none,
    adventures: 1000,
    turncount: 0,
    meat: 10_000_000,
    hp: 500,
    maxHp: 500,
    mp: 400,
    maxMp: 400,
    fullness: 0,
    fullnessLimit: 15,
    inebriety: 0,
    inebrietyLimit: 15,
    spleenUse: 0,
    spleenLimit: 15,
    playerClass: Class.get("Sauceror"),
    blockedLocations: new Set(),
    buyImpl: (item, count, limit) => {
      const price = state.mallPrices.get(item) ?? 0;
      if (price <= 0) return 0;
      if (limit !== undefined && limit > 0 && price > limit) return 0;
      state.inventory.set(item, (state.inventory.get(item) ?? 0) + count);
      return count;
    },
    makeValueThrows: false,
    cliHandlers: new Map(),
    log: {
      buys: [],
      uses: [],
      cliExecutes: [],
      mallSearches: [],
      skillsCast: [],
      hpRestores: [],
      mpRestores: [],
      prints: [],
      maximizes: [],
      retrieves: [],
    },
  };
  // Properties src reads without an explicit default and needs to be numeric.
  state.properties.set("valueOfAdventure", 4000);
  state.properties.set("_cloversPurchased", 0);
  state.properties.set("juneCleaverQueue", "");
  return state;
}

export let __state: GameState = freshState();

export function __resetState(): GameState {
  __state = freshState();
  return __state;
}

// ---------- functions ----------

export function abort(message?: string): never {
  throw new Error(`ABORT: ${message ?? ""}`);
}

export function availableAmount(item: Item): number {
  return itemAmount(item);
}

export function availableChoiceOptions(): { [option: number]: string } {
  return {};
}

export function booleanModifier(a: unknown, b?: string): boolean {
  if (typeof a === "string" && b !== undefined) {
    if (a === "Generated:_spec") return Boolean(__state.specMods[b]);
    return false;
  }
  if (typeof a === "string") return Boolean(__state.playerMods[a]);
  if (a instanceof Effect && b !== undefined) {
    return Boolean(__state.effectMods.get(a)?.[b]);
  }
  return false;
}

export function buy(a: Item | number, b: Item | number, priceLimit?: number): number {
  const item = a instanceof Item ? a : (b as Item);
  const count = a instanceof Item ? (b as number) : a;
  __state.log.buys.push({ item, count, limit: priceLimit });
  return __state.buyImpl(item, count, priceLimit);
}

export function canAdventure(location: Location): boolean {
  return !__state.blockedLocations.has(location);
}

export function canEquip(item: Item): boolean {
  return !__state.unequippable.has(item);
}

export function cliExecute(command: string): boolean {
  __state.log.cliExecutes.push(command);
  __state.cliHandlers.get(command)?.();
  return true;
}

export function create(count: number, item: Item): boolean {
  void count;
  void item;
  return true;
}

export function effectModifier(item: Item, modifier: string): Effect {
  if (modifier === "Effect") return __state.itemEffects.get(item) ?? Effect.none;
  return Effect.none;
}

export function equip(a: Slot | Item, b?: Slot | Item): boolean {
  const slot = a instanceof Slot ? a : b instanceof Slot ? b : __state.itemSlots.get(a as Item);
  const item = a instanceof Item ? a : (b as Item);
  if (slot !== undefined) {
    if (item === Item.none) __state.equipped.delete(slot);
    else __state.equipped.set(slot, item);
  }
  return true;
}

export function equippedAmount(item: Item): number {
  let n = 0;
  for (const worn of __state.equipped.values()) if (worn === item) n++;
  return n;
}

export function equippedItem(slot: Slot): Item {
  return __state.equipped.get(slot) ?? Item.none;
}

export function familiarWeight(familiar: Familiar): number {
  return __state.familiarWeights.get(familiar) ?? 20;
}

export function fullnessLimit(): number {
  return __state.fullnessLimit;
}

export function getFuel(): number {
  return 0;
}

export function getOutfits(): string[] {
  return [...__state.outfits.keys()];
}

export function getPower(item: Item): number {
  return __state.itemMods.get(item)?.Power ?? 0;
}

export function getWorkshed(): Item {
  return __state.workshed;
}

export function haveEffect(effect: Effect): number {
  return __state.effects.get(effect) ?? 0;
}

export function haveEquipped(item: Item): boolean {
  return equippedAmount(item) > 0;
}

export function haveOutfit(name: string): boolean {
  return __state.outfits.has(name);
}

export function hermit(item: Item, count: number): boolean {
  __state.inventory.set(item, (__state.inventory.get(item) ?? 0) + count);
  return true;
}

export function historicalPrice(item: Item): number {
  return __state.historicalPrices.get(item) ?? 0;
}

export function holiday(): string {
  return "";
}

export function hpCost(skill: Skill): number {
  return __state.skillHpCosts.get(skill) ?? 0;
}

export function inebrietyLimit(): number {
  return __state.inebrietyLimit;
}

export function itemAmount(item: Item): number {
  return __state.inventory.get(item) ?? 0;
}

export function mallPrice(item: Item, maxAge?: number): number {
  if (maxAge !== undefined && (__state.mallPriceAges.get(item) ?? Infinity) > maxAge) {
    __state.log.mallSearches.push({ item, maxAge });
    __state.mallSearchHandlers.get(item)?.();
  }
  return __state.mallPrices.get(item) ?? 0;
}

export function maximize(modifier: string, speculateOnly: boolean): boolean {
  return __state.maximizeImpl(modifier, speculateOnly);
}

export function mpCost(skill: Skill): number {
  return __state.skillMpCosts.get(skill) ?? 0;
}

export function myAdventures(): number {
  return __state.adventures;
}

export function myAscensions(): number {
  return 100;
}

export function myBuffedstat(stat: Stat): number {
  return __state.buffedStats[stat.name] ?? 0;
}

export function myClass(): Class {
  return __state.playerClass;
}

export function myFamiliar(): Familiar {
  return __state.currentFamiliar;
}

export function myFullness(): number {
  return __state.fullness;
}

export function myHp(): number {
  return __state.hp;
}

export function myInebriety(): number {
  return __state.inebriety;
}

export function myMaxhp(): number {
  return __state.maxHp;
}

export function myMaxmp(): number {
  return __state.maxMp;
}

export function myMeat(): number {
  return __state.meat;
}

export function myMp(): number {
  return __state.mp;
}

export function mySpleenUse(): number {
  return __state.spleenUse;
}

export function myTurncount(): number {
  return __state.turncount;
}

export function npcPrice(item: Item): number {
  return __state.npcPrices.get(item) ?? 0;
}

export function numericModifier(...args: unknown[]): number {
  if (args.length === 1 && typeof args[0] === "string") {
    const v = __state.playerMods[args[0]];
    return typeof v === "number" ? v : 0;
  }
  if (args.length === 2 && typeof args[0] === "string" && args[0] === "Generated:_spec") {
    // A speculated outfit's modifiers include the effects currently running, exactly as
    // mafia reports them. Without this the model cannot tell "the gear reaches 18" from
    // "the gear plus a buff that is about to expire reaches 18".
    const modifier = args[1] as string;
    const gear = __state.specMods[modifier];
    let total = typeof gear === "number" ? gear : 0;
    for (const [effect, turns] of __state.effects) {
      if (turns > 0) total += __state.effectMods.get(effect)?.[modifier] ?? 0;
    }
    return total;
  }
  if (args.length === 2) {
    const [thing, modifier] = args as [unknown, string];
    if (thing instanceof Item) return __state.itemMods.get(thing)?.[modifier] ?? 0;
    if (thing instanceof Effect) return __state.effectMods.get(thing)?.[modifier] ?? 0;
    return 0;
  }
  if (args.length === 4 && args[0] instanceof Familiar) {
    const [familiar, modifier, weight, equip] = args as [Familiar, string, number, Item];
    return __state.familiarModImpl(familiar, modifier, weight, equip);
  }
  return 0;
}

export function outfitPieces(name: string): Item[] {
  return __state.outfits.get(name) ?? [];
}

export function print(message: string, color?: string): void {
  void color;
  __state.log.prints.push(message);
}

export function restoreHp(target: number): boolean {
  __state.log.hpRestores.push(target);
  __state.hp = Math.max(__state.hp, Math.min(__state.maxHp, target));
  return true;
}

export function restoreMp(target: number): boolean {
  __state.log.mpRestores.push(target);
  __state.mp = Math.max(__state.mp, Math.min(__state.maxMp, target));
  return true;
}

export function retrieveItem(item: Item, count?: number): boolean {
  void count;
  __state.log.retrieves.push(item);
  return itemAmount(item) > 0;
}

export function runChoice(option: number): void {
  void option;
}

export function spleenLimit(): number {
  return __state.spleenLimit;
}

export function toItem(name: string): Item {
  return Item.get(name);
}

export function toSkill(name: string): Skill {
  return Skill.get(name);
}

export function toSlot(item: Item): Slot {
  return __state.itemSlots.get(item) ?? Slot.get("none");
}

export function use(a: Item | number, b?: Item | number): boolean {
  const item = a instanceof Item ? a : (b as Item);
  const count = a instanceof Item ? ((b as number) ?? 1) : a;
  __state.log.uses.push({ item, count });
  const owned = __state.inventory.get(item) ?? 0;
  __state.inventory.set(item, Math.max(0, owned - count));
  const effect = __state.itemEffects.get(item);
  if (effect !== undefined && effect !== Effect.none) {
    const duration = __state.itemMods.get(item)?.["Effect Duration"] ?? 1;
    __state.effects.set(effect, (__state.effects.get(effect) ?? 0) + count * duration);
  }
  return true;
}

export function useFamiliar(familiar: Familiar): boolean {
  __state.currentFamiliar = familiar;
  return true;
}

export function useSkill(skill: Skill, count?: number): boolean {
  void count;
  __state.log.skillsCast.push(skill);
  return true;
}

export function weaponType(item: Item): Stat {
  const type = __state.itemMods.get(item)?.WeaponRanged;
  return Stat.get(type === 1 ? "Moxie" : "Muscle");
}

export function weightAdjustment(): number {
  return __state.weightAdjustment;
}
