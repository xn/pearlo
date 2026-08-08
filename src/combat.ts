import {
  Item,
  equippedItem,
  getPower,
  haveEquipped,
  itemAmount,
  mpCost,
  myBuffedstat,
  numericModifier,
  weaponType,
} from "kolmafia";
import { $item, $skill, $slot, $stat, Macro, get, have } from "libram";

import { wineglassMode } from "./organs";
import { PearlSpec } from "./zones";

export const ZONE_MAX_HP = 800; // ganger, giant squid — highest HP in any pearl zone

export type DamagePlan = {
  perCast: number;
  casts: number;
  mpPerFight: number;
  oneShot: boolean;
};

// Lantern gear across ALL slots (user insight: a lantern ≈ an extra cast folded into
// the round, and any slot's lantern counts). Conservative component values:
// CMoI rolls 3 random elements, worst case one collides with the geyser's tune → 2;
// water purifier = cold AND sleaze → 2; wizard's pouch = hot AND physical → 2
// (physical is unresisted in pearl zones). Ordered by preference: components first,
// then slot scarcity. porcelain porkpie is EXCLUDED: its lantern only applies to
// Pastamancer-class spells, and Saucegeyser is a Sauceror spell.
// Rain-Doh green lantern last (rarity, per user). Retro cape handled via its mode.
type LanternGear = { item: Item; components: number; slot: "off-hand" | "accessory" };
const LANTERN_GEAR: LanternGear[] = [
  { item: $item`Congressional Medal of Insanity`, components: 2, slot: "accessory" },
  { item: $item`petrified wood water purifier`, components: 2, slot: "off-hand" },
  { item: $item`petrified wood wizard's pouch`, components: 2, slot: "accessory" },
  { item: $item`meteorb`, components: 1, slot: "off-hand" },
  { item: $item`snow mobile`, components: 1, slot: "off-hand" },
  { item: $item`big hot pepper`, components: 1, slot: "off-hand" },
  { item: $item`Rain-Doh green lantern`, components: 1, slot: "off-hand" },
];

function capeIsKillLantern(): boolean {
  return (
    haveEquipped($item`unwrapped knock-off retro superhero cape`) &&
    get("retroCapeSuperhero") === "heck" &&
    get("retroCapeWashingInstructions") === "kill"
  );
}

export function equippedLanternComponents(): number {
  let n = 0;
  for (const gear of LANTERN_GEAR) {
    if (haveEquipped(gear.item)) n += gear.components;
  }
  if (capeIsKillLantern()) n += 1;
  return n;
}

/** Upper bound on lantern components if we equip everything we own (planning pass). */
export function ownedLanternProspect(): number {
  let n = 0;
  for (const gear of LANTERN_GEAR) {
    if (have(gear.item)) n += gear.components;
  }
  if (have($item`unwrapped knock-off retro superhero cape`)) n += 1;
  return n;
}

export type LanternSelection = {
  /** Items to force-equip on the player (accessories + at most one off-hand). */
  equip: Item[];
  /** A further owned off-hand lantern for the Left-Hand Man, when still needed. */
  secondOffhand?: Item;
};

/**
 * Greedy selection of just enough owned lantern gear to cover `needed` components.
 * The player has one off-hand slot; a second off-hand lantern is only proposed (for
 * the Left-Hand Man) when the player-slot gear still leaves components uncovered.
 *
 * `accessorySlots`: organ extenders may pre-claim accessory slots; lantern gear must
 * not overflow the three accessory slots or Outfit.dress() throws.
 */
export function selectLanternGear(needed: number, accessorySlots = 3): LanternSelection {
  const equip: Item[] = [];
  let secondOffhand: Item | undefined;
  let offhandsUsed = 0;
  let accessoriesUsed = 0;
  let remaining = needed;
  for (const gear of LANTERN_GEAR) {
    if (remaining <= 0) break;
    if (!have(gear.item)) continue;
    if (gear.slot === "off-hand") {
      if (offhandsUsed === 0) {
        equip.push(gear.item);
        offhandsUsed++;
        remaining -= gear.components;
      } else if (secondOffhand === undefined) {
        secondOffhand = gear.item;
        remaining -= gear.components;
      }
    } else {
      if (accessoriesUsed >= accessorySlots) continue;
      equip.push(gear.item);
      accessoriesUsed++;
      remaining -= gear.components;
    }
  }
  return { equip, secondOffhand };
}

/**
 * Conservative (guaranteed-floor) Saucegeyser damage.
 * Per docs/superpowers/specs (Calculating_Spell_Damage): worst-case base roll 60,
 * 40% Myst, flat bonuses pre-multiplier, percent applied after the (infinite) cap.
 * Lanterns duplicate the highest component — modeled pre-multiplier (worst case)
 * and non-compounding, so the estimate is a floor.
 */
export function saucegeyserDamage(prospectiveLanterns?: number): number {
  const myst = myBuffedstat($stat`Mysticality`);
  const flat = numericModifier("Spell Damage");
  const elem = Math.min(numericModifier("Hot Spell Damage"), numericModifier("Cold Spell Damage"));
  const pct = numericModifier("Spell Damage Percent");
  const preMult = 60 + Math.floor(0.4 * myst) + flat + elem;
  const base = Math.ceil((1 + pct / 100) * preMult);
  const lanterns = prospectiveLanterns ?? equippedLanternComponents();
  return base + lanterns * Math.max(0, preMult);
}

/**
 * Minimal lantern components needed to one-shot the zone's toughest monster from the
 * current (pre-lantern-gear) state. 0 = raw Saucegeyser already suffices; Infinity =
 * even every owned component can't reach it (equip them all, plan multi-cast).
 */
export function lanternComponentsNeededForOneShot(targetHp = ZONE_MAX_HP): number {
  const max = ownedLanternProspect();
  for (let k = 0; k <= max; k++) {
    if (saucegeyserDamage(k) >= targetHp) return k;
  }
  return Infinity;
}

export function damagePlan(targetHp = ZONE_MAX_HP, prospectiveLanterns?: number): DamagePlan {
  const perCast = Math.max(1, saucegeyserDamage(prospectiveLanterns));
  const casts = Math.max(1, Math.ceil(targetHp / perCast));
  const mpPerFight =
    (have($skill`Entangling Noodles`) ? mpCost($skill`Entangling Noodles`) : 0) +
    casts * mpCost($skill`Saucegeyser`);
  return { perCast, casts, mpPerFight, oneShot: casts === 1 };
}

/**
 * Non-melee everywhere: the acoustic electric eel counters landed melee attacks
 * (~89-100 HP each) — spells never trigger it. Noodles (if known) buys 3-5 stunned
 * rounds when the kill isn't a one-shot; Saucegeyser repeats until the fight ends.
 */
export function buildPearlMacro(spec: PearlSpec, plan: DamagePlan): Macro {
  void spec; // per-monster branches (stench-zone pufferfish/dragonfish stuns) arrive with those zones
  if (wineglassMode()) {
    // Wineglass combat: every skill/item becomes a plain attack anyway — say so.
    return new Macro().attack().repeat();
  }
  const macro = new Macro();
  if (!plan.oneShot && have($skill`Entangling Noodles`)) {
    macro.trySkill($skill`Entangling Noodles`);
  }
  return macro.skill($skill`Saucegeyser`).repeat();
}

export type AttackPlan = {
  damage: number;
  hitGuaranteed: boolean;
  canOneShot: boolean;
  ranged: boolean;
};

/**
 * The wineglass must be in INVENTORY (or worn): the maximizer's speculation and the
 * engine's dress (autoSatisfyWithCloset: false) can't reach closet/storage copies,
 * so libram's have() saying yes is not enough.
 */
export function wineglassAccessible(): boolean {
  return itemAmount($item`Drunkula's wineglass`) > 0 || haveEquipped($item`Drunkula's wineglass`);
}

/** Attack stat needed for a guaranteed hit vs this Defense (wiki Hit_Chance). */
export function requiredAttackFor(targetDef: number): number {
  const r = 5 + Math.floor(Math.max(targetDef - 200, 0) / 20);
  return targetDef + 5 + r;
}

/**
 * Conservative plain-attack plan from the EQUIPPED weapon (wiki Weapon_Damage /
 * Hit_Chance, fetched 2026-08-08): damage =
 * floor((max(0, floor(stat×mult) − Def) + minWeaponRoll + flatWD [+ flatRanged]) × (1+pct%))
 * + elemental; ranged uses Moxie×0.75 and adds flat Ranged Damage inside the multiplier;
 * mysticality weapons hit and scale with Muscle. Hit is guaranteed when
 * stat − R ≥ Def + 5 with R = 5 + floor((Def−200)/20). Residual risk the model accepts:
 * fumbles (~1/22) deal zero damage regardless of any "can't miss" source.
 */
export function weaponAttackPlan(
  targetDef: number,
  targetHp: number,
  weapon: Item = equippedItem($slot`weapon`),
): AttackPlan {
  const ranged = weaponType(weapon) === $stat`Moxie`;
  const attackStat = myBuffedstat(ranged ? $stat`Moxie` : $stat`Muscle`);
  const minRoll = Math.floor(getPower(weapon) / 10);
  const flatWD = numericModifier("Weapon Damage");
  const pctWD = numericModifier("Weapon Damage Percent") / 100;
  const flatRanged = ranged ? numericModifier("Ranged Damage") : 0;
  const elemental =
    numericModifier("Hot Damage") +
    numericModifier("Cold Damage") +
    numericModifier("Spooky Damage") +
    numericModifier("Stench Damage") +
    numericModifier("Sleaze Damage");
  const statTerm = Math.max(0, Math.floor(attackStat * (ranged ? 0.75 : 1)) - targetDef);
  const damage = Math.floor((statTerm + minRoll + flatWD + flatRanged) * (1 + pctWD)) + elemental;
  const r = 5 + Math.floor(Math.max(targetDef - 200, 0) / 20);
  const hitGuaranteed = attackStat - r >= targetDef + 5;
  return { damage, hitGuaranteed, canOneShot: hitGuaranteed && damage >= targetHp, ranged };
}
