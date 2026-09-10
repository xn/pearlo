import {
  Effect,
  Element,
  Item,
  booleanModifier,
  buy,
  cliExecute,
  effectModifier,
  equippedItem,
  familiarWeight,
  haveEffect,
  hpCost,
  itemAmount,
  mpCost,
  myFamiliar,
  myHp,
  myMaxhp,
  myMaxmp,
  myMp,
  numericModifier,
  print,
  weightAdjustment,
  restoreHp,
  restoreMp,
  toItem,
  toSkill,
  use,
} from "kolmafia";
import {
  $effect,
  $effects,
  $elements,
  $familiar,
  $familiars,
  $item,
  $items,
  $slot,
  get,
  getSaleValue,
  have,
  sum,
  uneffect,
  withProperties,
} from "libram";

import { args } from "./args";
import type { ResPotionPlan } from "./economics";
import { canAcquireEffect, restorerItemSettings, tryAcquiringEffect } from "./lib";
import { wineglassMode } from "./organs";
import { PEARL_RES_CAP, PearlKey, PearlSpec, progressRatePct, resModifierName } from "./zones";

// Every list below is wiki-verified (effect pages fetched 2026-08-07); the original
// usefulEffects list mixed genuine resistance with stat/HP/familiar buffs — sorted here.

// True all-element resistance: Elemental Saucesphere +2, Feeling Peaceful +2,
// Astral Shell +1.
const ALL_ELEMENT_RES_EFFECTS = $effects`Elemental Saucesphere, Feeling Peaceful, Astral Shell`;

// Block-class defense: Blood Bubble makes the first hit per combat auto-miss
// (multi-attack monsters can still land extras). Sauceror skill, permable,
// costs 30 HP (not MP!) for 3 turns — cast BEFORE the HP restore below tops us up.
const BLOCK_EFFECTS = $effects`Blood Bubble`;

// Partial resistance: cold+sleaze only. Scarysauce +2, Scariersauce +6 (Scarysauce cast
// while wielding a velour viscometer); they stack (+8 together on top of the all-element set).
const PARTIAL_RES_EFFECTS: [Effect, Element[]][] = [
  [$effect`Scarysauce`, $elements`cold, sleaze`],
  [$effect`Scariersauce`, $elements`cold, sleaze`],
];

// Stats: Mysticality % feeds Saucegeyser damage; Moxie % feeds dodge.
const STAT_EFFECTS = $effects`Big, Stevedave's Shanty of Superiority, Feeling Excited`;

// Max-HP padding for rounds where the kill isn't a one-shot.
const HP_EFFECTS = $effects`Reptilian Fortitude, A Few Extra Pounds, Power Ballad of the Arrowsmith, Mariachi Mood, Patience of the Tortoise`;

// +5 familiar weight each — pointless with no familiar out; Blood Bond also drains
// 8-10 HP per adventure, so it stays out of v1 entirely.
const FAMILIAR_WEIGHT_EFFECTS = $effects`Empathy, Leash of Linguini, Only Dogs Love a Drunken Sailor`;

// Verified spell-damage effects (Bonus_Spell_Damage wiki page):
// Carol of the Hells +100% spell dmg; Song of Sauce +100% and +50 hot;
// Jackasses' Symphony +12 flat. Acquisition is free-first via canAcquireEffect.
const SPELL_DAMAGE_EFFECTS = $effects`Carol of the Hells, Song of Sauce, Jackasses' Symphony of Destruction`;

// Weapon-damage % effects for wineglass (attack-only) combat: Carol of the Bulls,
// Song of the North (user, 2026-08-08); Frenzied, Bloody = Blood Frenzy's +50%
// weapon damage for 30 HP — the comma in its name forces the singular template.
const WEAPON_DAMAGE_EFFECTS = [
  ...$effects`Carol of the Bulls, Song of the North`,
  $effect`Frenzied, Bloody`,
];

// Damage mitigation (garbo sea-farming parity, wiki-verified 2026-08-15): pearl-zone
// damage is almost entirely physical (docs/sea-reference.md), so Damage Absorption
// +80 (Ghostly Shell) and −30% physical damage taken (Shield of the Pastalord)
// cover both combat modes.
const DEFENSE_EFFECTS = $effects`Ghostly Shell, Shield of the Pastalord`;

// Muscle +10 and 20–30 HP regen/adventure: Disco Aerobics cast with the April Shower
// Thoughts shield (lib.ts owns the offhand swap). The regen offsets restore costs.
const REGEN_EFFECTS = $effects`Disco over Matter`;

// Pressure reduction ("makes you a better diver") — claws back the initiative the
// pearl zones' pressure penalties eat, i.e. the pufferfish-stun setup. AT song
// (user knows the skill, 2026-08-15); with the statuseffects.txt song census this
// is the 4th of the user's 4 song slots, so nothing gets displaced.
const PRESSURE_EFFECTS = $effects`Donho's Bubbly Ballad`;

// Effects that break pearl farming outright (garbo's shrugBadEffects, trimmed to the
// modifiers that matter here): Adventure Randomly teleports turns out of the zone,
// Alters Page Text can break mafia's response parsing (progress tracking), Always
// Fumble voids the wineglass one-shot guarantee, Blind hides combat text. Computed
// lazily from local modifier data — no server hits.
let badEffectsCache: Effect[] | undefined;
function badEffects(): Effect[] {
  return (badEffectsCache ??= Effect.all().filter(
    (ef) =>
      booleanModifier(ef, "Adventure Randomly") ||
      booleanModifier(ef, "Alters Page Text") ||
      booleanModifier(ef, "Always Fumble") ||
      booleanModifier(ef, "Blind"),
  ));
}

// Weight-scaled resistance familiars (docs/sea-reference.md): more familiar weight is
// more elemental res toward the 18 cap — the only case the weight potions pay off.
const WEIGHT_RES_FAMILIARS = $familiars`Exotic Parrot, Mu`;
// Underwater-only familiar-weight potions (garbo Coral Corral parity, wiki-verified
// 2026-08-15): temporary teardrop tattoo → Crocodile Tear (+10 lbs, 15 adv, ganger
// drop), sea grease → Greased-Up Familiar (+5 lbs, 40 adv, Big Brother 5 sand
// dollars). Inventory only — free/owned default.
const FAMILIAR_WEIGHT_POTIONS = $items`temporary teardrop tattoo, sea grease`;

/**
 * Use owned underwater famweight potions while a weight-scaled res familiar is out —
 * but only when the resistance the added weight actually buys is worth what the potions
 * would have sold for. These familiars gain resistance in whole steps of weight, so most
 * of the time a few pounds buys nothing and the potions were pure waste.
 */
export function topUpFamiliarWeight(spec: PearlSpec, worthIt: WorthIt, turnsFor: TurnsFor): void {
  const familiar = myFamiliar();
  if (!WEIGHT_RES_FAMILIARS.includes(familiar)) return;
  const resName = resModifierName(spec.key);
  const startRes = numericModifier(resName);
  if (startRes >= PEARL_RES_CAP) return;

  const need = coverageTurns(spec, turnsFor);
  const planned: { item: Item; copies: number; pounds: number; value: number }[] = [];
  for (const it of FAMILIAR_WEIGHT_POTIONS) {
    const ef = effectModifier(it, "Effect");
    if (ef === $effect.none || have(ef) || itemAmount(it) === 0) continue;
    const duration = Math.max(1, numericModifier(it, "Effect Duration"));
    const copies = Math.min(itemAmount(it), Math.ceil(need / duration));
    if (copies <= 0) continue;
    planned.push({
      item: it,
      copies,
      pounds: numericModifier(ef, "Familiar Weight"),
      value: copies * getSaleValue(it),
    });
  }
  if (planned.length === 0) return;

  // What the extra pounds are worth is the familiar's own step function, so ask it.
  const equip = equippedItem($slot`familiar`);
  const weight = familiarWeight(familiar) + weightAdjustment();
  const resAt = (pounds: number) => numericModifier(familiar, resName, weight + pounds, equip);
  const base = resAt(0);

  // Weigh the combinations, not just the whole set: these familiars gain resistance in
  // steps, so one potion that crosses a step must not be vetoed by another that cannot.
  // Biggest gain first, so the best step we can afford is the one taken.
  const subsets = Array.from({ length: 1 << planned.length }, (_, mask) =>
    planned.filter((_p, i) => mask & (1 << i)),
  )
    .filter((subset) => subset.length > 0)
    .map((subset) => ({
      subset,
      gain: resAt(sum(subset, (p) => p.pounds)) - base,
      value: sum(subset, (p) => p.value),
    }))
    .filter((c) => c.gain > 0)
    .sort((a, b) => b.gain - a.gain || a.value - b.value);

  const chosen = subsets.find((c) => worthIt(startRes, c.gain, c.value));
  if (chosen === undefined) return;
  for (const { item, copies } of chosen.subset) use(item, copies);
}

const implementWarned = new Set<Effect>();

/**
 * Run `action` with every buy-side source off, so buffs cost MP and never meat: mafia
 * otherwise buys a skill's casting implement through retrieveItem, stopping at the
 * class *default* tool rather than a lesser one already owned. Wrapped around a whole
 * buff pass rather than each cast, since mafia logs all four preferences per change.
 */
function withoutBuying<T>(action: () => T): T {
  return withProperties(
    {
      autoSatisfyWithMall: false,
      autoSatisfyWithNPCs: false,
      autoSatisfyWithCoinmasters: false,
      autoSatisfyWithStorage: false,
    },
    action,
  );
}

/**
 * Acquire one buff. Callers must already be inside withoutBuying. A buff we expected to
 * land and didn't is announced once: silently dropping the spell-damage songs for want
 * of an accordion would be a large, invisible cost.
 */
function acquireEffectFree(ef: Effect): void {
  const expected = canAcquireEffect(ef);
  // Buff implements are not budgetable: mafia retrieves the *default* tool of the class
  // (oil pan, Ouija board) before it will fall back to a lesser one already owned, so
  // permitting any purchase permits a five-figure one that nothing here priced. Storage
  // counts as buy-side for the same reason.
  tryAcquiringEffect(ef);
  if (expected && !have(ef) && !implementWarned.has(ef)) {
    implementWarned.add(ef);
    print(
      `pearlo: skipped ${ef} — it needs an implement or MP we don't have, and buffs ` +
        `never spend meat. Acquire the implement to get this buff back.`,
      "red",
    );
  }
}

/** The zone's resistance skill-buffs: all-element plus its own partial-element set. */
function resBuffs(spec: PearlSpec): Effect[] {
  return [
    ...ALL_ELEMENT_RES_EFFECTS,
    ...PARTIAL_RES_EFFECTS.filter(([, elements]) => elements.includes(spec.element)).map(
      ([ef]) => ef,
    ),
  ];
}

/**
 * Cast the zone's resistance buffs before the outfit is built, so the maximizer plans
 * against buffed resistance instead of spending slots to make up the difference.
 * Repeating is cheap (a have() check each), and pearlMood re-tries anything skipped.
 */
export function castFreeResBuffs(spec: PearlSpec): void {
  const pending = resBuffs(spec).filter((ef) => !have(ef));
  if (pending.length === 0) return;
  // Restore first: canAcquireEffect gates casts on current MP, so buffing on a low-MP
  // entry silently skips them and leaves the maximizer on an unbuffed baseline — the
  // very ordering this pass exists to fix.
  const cost = pendingCastCosts(pending);
  if (myMp() < cost.mp) restoreMp(Math.min(myMaxmp(), cost.mp));
  if (myHp() <= cost.hp) restoreHp(myMaxhp());
  withoutBuying(() => pending.forEach(acquireEffectFree));
}

/**
 * Cast the selected zones' resistance skill-buffs before the profit model prices
 * anything, so its speculative maximizes measure them instead of predicting them.
 * Predicting was wrong in three ways at once: Feel Peaceful is 3/day but was credited
 * to all five zones, a buff whose casting implement we lack was counted and then
 * skipped, and an over-predicted baseline makes the run under-buy and farm a tier
 * below what it was priced at.
 */
export function castSharedResBuffs(selected: PearlSpec[]): void {
  const buffs = [...new Set(selected.flatMap(resBuffs))];
  const pending = buffs.filter((ef) => !have(ef));
  if (pending.length === 0) return;
  const cost = pendingCastCosts(pending);
  // Pre-engine, so the engine's restore policy is not installed yet — never burn a
  // free rest or an unvetted restorer just to buff.
  withProperties(restorerItemSettings(), () => {
    if (myMp() < cost.mp) restoreMp(Math.min(myMaxmp(), cost.mp));
    if (myHp() <= cost.hp) restoreHp(myMaxhp());
  });
  withoutBuying(() => pending.forEach(acquireEffectFree));
}

/** Feel Peaceful is 3/day, and a spent skill still reads castable. */
function dailyCastsLeft(ef: Effect): boolean {
  return ef !== $effect`Feeling Peaceful` || get("_feelPeacefulUsed", 0) < 3;
}

/**
 * Resistance the report paths are missing: castable res buffs not yet active. The
 * reports price without casting anything; a real run casts these before pricing.
 */
export function uncastResBuffBonus(spec: PearlSpec): number {
  const resName = resModifierName(spec.key);
  return sum(
    resBuffs(spec).filter((ef) => !have(ef) && canAcquireEffect(ef) && dailyCastsLeft(ef)),
    (ef) => numericModifier(ef, resName),
  );
}

/** Per-zone res top-up potions (overrides.<key>resitems), parsed and warned once. */
const resItemCache = new Map<PearlKey, Item[]>();
export function resItems(key: PearlKey): Item[] {
  const cached = resItemCache.get(key);
  if (cached) return cached;
  const raw = {
    spooky: args.overrides.spookyresitems,
    sleaze: args.overrides.sleazeresitems,
    hot: args.overrides.hotresitems,
    stench: args.overrides.stenchresitems,
    cold: args.overrides.coldresitems,
  }[key];
  const items: Item[] = [];
  for (const name of raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")) {
    const it = toItem(name);
    if (it === $item.none) {
      print(`pearlo: unknown item "${name}" in ${key}resitems — skipping it.`, "red");
    } else {
      items.push(it);
    }
  }
  resItemCache.set(key, items);
  return items;
}

const resShortfallWarned = new Set<PearlKey>();
const planShortfallWarned = new Set<PearlKey>();

/** Potions whose purchase failed, per zone: a later zone's mall may well restock. */
const failedBuy = new Map<PearlKey, Set<Item>>();

// Latched after an unsuccessful Mom visit (not rescued this ascension, not
// reachable) so later zones don't retry-spam her every prep.
let momAttemptFailed = false;

/**
 * Mom Sea Monkee's free daily food: +7 in the zone's element for 50 adventures
 * (mafia's `mom` command handles travel, breathing gear, and _momFoodReceived).
 * Last resort after skills and potions — only fires when the zone still can't
 * cap, per the mombuff arg (auto = first under-capped zone claims it; an element
 * value reserves it for that zone).
 */
function tryMomBuff(spec: PearlSpec): void {
  const mode = args.resources.mombuff;
  if (mode === undefined || momAttemptFailed) return;
  if (mode !== "auto" && mode !== spec.key) return;
  if (get("_momFoodReceived")) return;
  cliExecute(`mom ${spec.key}`);
  if (!get("_momFoodReceived")) {
    momAttemptFailed = true;
    print(
      "pearlo: Mom Sea Monkee was unavailable (not rescued this ascension?) — skipping the mombuff top-up for the rest of the run.",
      "red",
    );
  }
}

/**
 * Turns of effect needed to finish this pearl: remaining fights at the capped
 * 10%/fight rate, doubled without Fishy (underwater fights cost 2 turns).
 * Padded by 2 adventures of slack: non-fight turns (the zone's Lucky! NC, wandering
 * NCs) burn effect turns without pearl progress. `ratePct` is the progress rate the
 * caller expects to farm at — resistance potions pass their plan's rate, which is not
 * always the 10% cap.
 */
function coverageTurns(spec: PearlSpec, turnsFor: TurnsFor, ratePct = 10): number {
  const fights = Math.ceil((100 - get(spec.progress, 0)) / ratePct);
  // Two adventures of slack for the non-fight turns (the zone's Lucky! NC, wanderers)
  // that burn effect turns without pearl progress.
  return turnsFor(fights) + 2;
}

type PlanItem = {
  item: Item;
  effect: Effect;
  want: number;
  buyPrice: number;
  saleValue: number;
};

/** Asks the profit model whether a resistance step still pays; supplied by pearls.ts. */
export type WorthIt = (fromRes: number, gain: number, cost: number) => boolean;

/** Converts a fight count to adventures, on the profit model's own arithmetic. */
export type TurnsFor = (fights: number) => number;

/** Copies of `item` this entry still needs for what the pearl has left to run. */
function copiesWanted(
  spec: PearlSpec,
  item: Item,
  count: number,
  ratePct: number,
  turnsFor: TurnsFor,
): number {
  const duration = Math.max(1, numericModifier(item, "Effect Duration"));
  return Math.min(count, Math.ceil(coverageTurns(spec, turnsFor, ratePct) / duration));
}

function totalGain(spec: PearlSpec, members: PlanItem[]): number {
  return sum(members, ({ effect }) => numericModifier(effect, resModifierName(spec.key)));
}

/**
 * Spend a zone's approved potion plan, all-or-nothing and only while it still pays.
 *
 * The plan is a *subset*, because potions that cross no step alone can cross one
 * together — so drinking part of one is how you pay for a tier you do not get. And it
 * was costed against a speculative resistance, so the profit test is re-asked against
 * the resistance actually dressed, through the model that made the original decision.
 */
function executeResPlan(
  spec: PearlSpec,
  plan: ResPotionPlan,
  startRes: number,
  worthIt: WorthIt,
  turnsFor: TurnsFor,
): void {
  const zoneFailures = failedBuy.get(spec.key) ?? new Set<Item>();
  const ratePct = progressRatePct(plan.res);

  const pending = plan.use
    .map(({ item, count, buyPrice, saleValue }) => ({
      item,
      buyPrice,
      saleValue,
      effect: effectModifier(item, "Effect"),
      want: copiesWanted(spec, item, count, ratePct, turnsFor),
    }))
    .filter(({ effect, want }) => effect !== $effect.none && !have(effect) && want > 0);
  if (pending.length === 0) return;

  const affordable = ({ item, buyPrice, want }: PlanItem) =>
    itemAmount(item) >= want ||
    (item.tradeable &&
      !zoneFailures.has(item) &&
      Number.isFinite(buyPrice) &&
      buyPrice > 0 &&
      buyPrice <= args.resources.potionprice);

  // Drop what we cannot get before spending anything, then ask the profit model whether
  // the remainder still pays. Only meat we are about to spend counts: copies already in
  // inventory were paid for long ago, and re-charging them refuses steps that do pay.
  const viable = pending.filter(affordable);
  if (viable.length === 0) return;
  // A copy on hand is not free: drinking it forfeits what it would have sold for, which
  // is exactly what the gate charged for it.
  const ownedBefore = new Map(viable.map(({ item }) => [item, itemAmount(item)]));
  const spendFor = ({ item, buyPrice, saleValue, want }: PlanItem) => {
    const owned = Math.min(want, ownedBefore.get(item) ?? 0);
    const buying = Math.max(0, want - owned);
    // Guard the multiply: purchaseCost is Infinity for an unpriceable item, and
    // 0 * Infinity is NaN, which would poison the whole sum and void the plan.
    return owned * saleValue + (buying > 0 ? buying * buyPrice : 0);
  };
  const outlay = sum(viable, spendFor);
  if (!worthIt(startRes, totalGain(spec, viable), outlay)) return;

  // A partial fill is progress: the copies land, `want` decays as the pearl runs, and
  // the next pass finishes it. Only a fill that returns nothing is worth remembering —
  // that is an empty mall, and retrying it every fight is the waste.
  for (const { item, buyPrice, want } of viable) {
    const short = want - itemAmount(item);
    if (short <= 0) continue;
    if (buy(item, short, Math.ceil(buyPrice)) === 0) {
      zoneFailures.add(item);
      failedBuy.set(spec.key, zoneFailures);
    }
  }

  // Drink whatever fully arrived, provided it still crosses a step on its own.
  const obtained = viable.filter(({ item, want }) => itemAmount(item) >= want);
  if (obtained.length === 0) return;
  // The meat is already gone, so the bar here is only that drinking beats not drinking.
  // Purchases are sunk by now, so only the copies we already had are still forgone —
  // charging the bought ones again here would refuse what the first test just approved.
  if (
    !worthIt(
      startRes,
      totalGain(spec, obtained),
      sum(
        obtained,
        ({ item, saleValue, want }) => Math.min(want, ownedBefore.get(item) ?? 0) * saleValue,
      ),
    )
  ) {
    return;
  }
  for (const { item, want } of obtained) use(item, want);
}

/**
 * Spend the zone's approved resistance plan. Runs after the skill buffs and the
 * familiar escalation, so meat only ever covers the tier free resistance did not reach.
 * Anything that expires mid-pearl is re-upped by the next pre-fight pass.
 */
export function topUpRes(
  spec: PearlSpec,
  plan: ResPotionPlan,
  worthIt: WorthIt,
  turnsFor: TurnsFor,
): void {
  const resName = resModifierName(spec.key);
  const startRes = numericModifier(resName);
  if (startRes < PEARL_RES_CAP) executeResPlan(spec, plan, startRes, worthIt, turnsFor);

  if (numericModifier(resName) < PEARL_RES_CAP) tryMomBuff(spec);

  // The profit gate approved this zone at plan.res. Checked after Mom, which can still
  // cover the gap; below it, the zone farms under the estimate that approved it.
  const reached = numericModifier(resName);
  if (reached < plan.res && !planShortfallWarned.has(spec.key)) {
    planShortfallWarned.add(spec.key);
    print(
      `pearlo: ${spec.key} res reached ${reached}, not the ${plan.res} its potion plan was ` +
        `priced at — ${spec.loc} will farm below its profit estimate.`,
      "red",
    );
  }
  const finalRes = numericModifier(resName);
  if (finalRes < PEARL_RES_CAP && !resShortfallWarned.has(spec.key)) {
    resShortfallWarned.add(spec.key);
    print(
      `pearlo: ${spec.key} res is ${finalRes} after the ${spec.key}resitems top-up (< ${PEARL_RES_CAP} cap) — pearl progress runs below 10%/fight. Stock more of the list, extend it, or set mombuff for more sources.`,
      "red",
    );
  }
}

/** Effect lists that apply to this zone/state, in cast order (HP-costed blocks last). */
function applicableBuffs(spec: PearlSpec): Effect[] {
  return [
    ...ALL_ELEMENT_RES_EFFECTS,
    ...PARTIAL_RES_EFFECTS.filter(([, elements]) => elements.includes(spec.element)).map(
      ([ef]) => ef,
    ),
    ...STAT_EFFECTS,
    ...HP_EFFECTS,
    ...DEFENSE_EFFECTS,
    ...REGEN_EFFECTS,
    ...PRESSURE_EFFECTS,
    ...(myFamiliar() !== $familiar.none ? FAMILIAR_WEIGHT_EFFECTS : []),
    // Wineglass combat kills spells — spell-damage songs are dead weight overdrunk;
    // weapon-damage songs take their place (and vice versa while sober).
    ...(wineglassMode() ? WEAPON_DAMAGE_EFFECTS : SPELL_DAMAGE_EFFECTS),
    // HP-costed buffs (Blood Bubble 30 HP) last, right before restores recover the cost.
    // (Blood Bubble is a noncombat cast; its first-hit block still works overdrunk.)
    ...BLOCK_EFFECTS,
  ];
}

/**
 * MP/HP the pending skill-casts among `effects` would cost (missing effects whose
 * default acquisition is a cast — same "cast 1 Skill Name" parse as canAcquireEffect).
 */
function pendingCastCosts(effects: Effect[]): { mp: number; hp: number } {
  let mp = 0;
  let hp = 0;
  for (const ef of effects) {
    if (have(ef) || !ef.default) continue;
    const parts = ef.default.split(" ");
    if (parts[0] !== "cast") continue;
    // "cast N Skill ^ Effect" defaults name the granted effect after a caret.
    const sk = toSkill(parts.slice(2).join(" ").split(" ^ ")[0]);
    if (!have(sk)) continue;
    mp += mpCost(sk);
    hp += hpCost(sk);
  }
  return { mp, hp };
}

/** Said once per zone while Lucky! is up; cleared when it lapses so a re-acquire warns. */
const luckyNoticePrinted = new Set<PearlKey>();

export function pearlMood(
  spec: PearlSpec,
  mpPerFight: number,
  worthIt: WorthIt,
  turnsFor: TurnsFor,
): void {
  // Lucky! is spent on the zone's Lucky noncombat instead of a pearl fight, so only a zone
  // that has one is worth flagging. The Fishy clause defers to Get Fishy, which spends the
  // effect in The Brinier Deepers before we get here. Said once per zone while it is up.
  if (!have($effect`Lucky!`)) {
    luckyNoticePrinted.clear();
  } else if (
    spec.luckyNoncombat !== undefined &&
    (haveEffect($effect`Fishy`) > 1 || !args.resources.luckyfishy) &&
    !luckyNoticePrinted.has(spec.key)
  ) {
    luckyNoticePrinted.add(spec.key);
    print(
      `pearlo: Lucky! is active — the next ${spec.loc} adventure may be ${spec.luckyNoncombat} instead of a pearl fight. Consider spending Lucky elsewhere first.`,
      "red",
    );
  }
  // Fishy: free pipe only in v1 (docs/consumption-reference.md). Lutz's 30 turns are
  // taken up front by their own task, before any zone is priced against them.
  if (!have($effect`Fishy`) && have($item`fishy pipe`) && !get("_fishyPipeUsed")) {
    use($item`fishy pipe`);
  }

  // Shed run-breaking effects first (uneffect spends a remover on non-shruggables —
  // worth it, these void turns or the one-shot guarantee outright).
  for (const ef of badEffects()) {
    if (have(ef)) uneffect(ef);
  }

  const buffs = applicableBuffs(spec);

  // MP economy (user feedback: hovering at ~2 casts of MP against a huge pool is way
  // too low): keep a real buffer — trigger below 5 fights' worth, refill to 20 fights'
  // worth (capped by max MP), and never below the pending buff casts' summed cost.
  const pending = pendingCastCosts(buffs);
  const mpTrigger = Math.max(pending.mp, 5 * mpPerFight);
  const mpTarget = Math.min(myMaxmp(), Math.max(pending.mp + 5 * mpPerFight, 20 * mpPerFight));
  // Wineglass combat can't heal or stun mid-fight, and a lost-initiative or fumble
  // round lands unanswered hits — enter fights near-full (90%) instead of 60%.
  const hpFloor = wineglassMode() ? 0.9 : 0.6;
  if (myMp() < mpTrigger) restoreMp(mpTarget);
  if (myHp() <= pending.hp || myHp() < hpFloor * myMaxhp()) restoreHp(myMaxhp());

  // Non-resistance buffs stay free-only: their value is damage and MP, not turns.
  withoutBuying(() => buffs.forEach(acquireEffectFree));

  topUpFamiliarWeight(spec, worthIt, turnsFor);

  // BEFORE adventuring: the buffs spent MP/HP — re-verify the fight buffer.
  // Explicit restores; auto-recovery is disabled by PearloEngine.
  if (myMp() < 5 * mpPerFight) restoreMp(Math.min(myMaxmp(), 20 * mpPerFight));
  if (myHp() < hpFloor * myMaxhp()) restoreHp(myMaxhp());
}
