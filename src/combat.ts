import { Item, haveEquipped, mpCost, myBuffedstat, numericModifier } from "kolmafia";
import { $item, $skill, $stat, Macro, get, have } from "libram";

import { PearlSpec } from "./zones";

export const ZONE_MAX_HP = 800; // ganger, giant squid — highest HP in any pearl zone

export type DamagePlan = {
  perCast: number;
  casts: number;
  mpPerFight: number;
  oneShot: boolean;
};

// Lantern components added per equipped source, conservative counts.
// CMoI rolls 3 random elements; worst case one collides with the geyser's tune → 2.
// petrified wood water purifier adds cold AND sleaze → 2.
// See docs/sea-reference.md and the Lanterns notes in the spec.
const LANTERN_COMPONENTS: [Item, number][] = [
  [$item`Congressional Medal of Insanity`, 2],
  [$item`petrified wood water purifier`, 2],
  [$item`meteorb`, 1],
  [$item`snow mobile`, 1],
  [$item`big hot pepper`, 1],
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
  for (const [item, components] of LANTERN_COMPONENTS) {
    if (haveEquipped(item)) n += components;
  }
  if (capeIsKillLantern()) n += 1;
  return n;
}

/** Upper bound on lantern components if we equip everything we own (planning pass). */
export function ownedLanternProspect(): number {
  let n = 0;
  for (const [item, components] of LANTERN_COMPONENTS) {
    if (have(item)) n += components;
  }
  if (have($item`unwrapped knock-off retro superhero cape`)) n += 1;
  return n;
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
  const macro = new Macro();
  if (!plan.oneShot && have($skill`Entangling Noodles`)) {
    macro.trySkill($skill`Entangling Noodles`);
  }
  return macro.skill($skill`Saucegeyser`).repeat();
}
