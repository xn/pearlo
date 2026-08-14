import { step } from "grimoire-kolmafia";
import {
  abort,
  availableAmount,
  buy,
  cliExecute,
  create,
  Effect,
  equip,
  equippedItem,
  fullnessLimit,
  getFuel,
  haveEquipped,
  holiday,
  hpCost,
  inebrietyLimit,
  mpCost,
  myAscensions,
  myClass,
  myFullness,
  myHp,
  myInebriety,
  myMeat,
  myMp,
  mySpleenUse,
  print,
  restoreMp,
  retrieveItem,
  spleenLimit,
  toItem,
  toSkill,
  use,
  useSkill,
} from "kolmafia";
import {
  $class,
  $effect,
  $item,
  $items,
  $skill,
  $slot,
  AsdonMartin,
  get,
  have,
  unequip,
  Witchess,
} from "libram";

export function debug(message: string, color?: string): void {
  if (color) {
    print(message, color);
  } else {
    print(message);
  }
}

/**
 * Return true if we can possibly fuel the asdon to the required amount.
 */
export function asdonFualable(amount: number): boolean {
  if (!AsdonMartin.installed()) return false;
  if (
    !have($item`forged identification documents`) &&
    step("questL11Black") < 4 &&
    myMeat() < 10000
  )
    return false; // Save early
  if (amount <= getFuel()) return true;

  // Use wad of dough with the bugbear outfit
  if (have($item`bugbear bungguard`) && have($item`bugbear beanie`)) {
    return myMeat() >= (amount - getFuel()) * 24 + 1000; // Save 1k meat as buffer
  }

  // Use all-purpose flower if we have enough ascensions
  if (myAscensions() >= 10 && (have($item`bitchin' meatcar`) || have($item`Desert Bus pass`))) {
    return myMeat() >= 3000 + (amount - getFuel()) * 14; // 2k for all-purpose flower + save 1k meat as buffer + soda water
  }

  return false;
}

export function fuelUp(): void {
  buy(1, $item`all-purpose flower`);
  use($item`all-purpose flower`);
  buy(23, $item`soda water`);
  create(23, $item`loaf of soda bread`);
  cliExecute(`asdonmartin fuel ${availableAmount($item`loaf of soda bread`)} soda bread`);
}
const improvedShowerSkills = new Map([
  [$effect`Slippery as a Seal`, $skill`Seal Clubbing Frenzy`],
  [$effect`Strength of the Tortoise`, $skill`Patience of the Tortoise`],
  [$effect`Thoughtful Empathy`, $skill`Empathy of the Newt`],
  [$effect`Tubes of Universal Meat`, $skill`Manicotti Meditation`],
  [$effect`Leash of Linguini`, $skill`Leash of Linguini`],
  [$effect`Lubricating Sauce`, $skill`Sauce Contemplation`],
  [$effect`Simmering`, $skill`Simmer`],
  [$effect`Disco over Matter`, $skill`Disco Aerobics`],
  [$effect`Mariachi Moisture`, $skill`Moxie of the Mariachi`],
]);
export const forbiddenEffects: Effect[] = [];

export function canAcquireEffect(ef: Effect): boolean {
  // This will not attempt to craft items to acquire the effect, which is the behaviour of ef.default
  // You will need to have the item beforehand for this to return true
  return ef.all
    .map((defaultAction) => {
      if (defaultAction.length === 0) return false; // This effect is not acquirable
      const splitString = defaultAction.split(" ");
      const action = splitString[0];
      const target = splitString.slice(2).join(" ");

      switch (action) {
        case "eat": // We have the food
        case "drink": // We have the booze
        case "chew": // We have the spleen item
        case "use": // We have the item
          if (ef === $effect`Sparkling Consciousness` && get("_fireworkUsed")) return false;
          return have(toItem(target));
        case "cast": {
          // We have the skill and can afford it — some skills (Blood Bubble,
          // Blood Bond) cost HP rather than MP; never cast into unconsciousness.
          const sk = toSkill(target);
          return have(sk) && myMp() >= mpCost(sk) && myHp() > hpCost(sk);
        }
        case "cargo":
          return false; // Don't acquire effects with cargo (items are usually way more useful)
        case "synthesize":
          return false; // We currently don't support sweet synthesis
        case "barrelprayer":
          return (
            get("barrelShrineUnlocked") && !get("_barrelPrayer") && myClass() === $class`Sauceror`
          );
        case "witchess":
          return Witchess.have() && get("puzzleChampBonus") >= 20 && !get("_witchessBuff");
        case "telescope":
          return get("telescopeUpgrades") > 0 && !get("telescopeLookedHigh");
        case "beach":
          return have($item`Beach Comb`); // need to check if specific beach head has been taken
        case "spacegate":
          return get("spacegateAlways") && !get("_spacegateVaccine");
        case "pillkeeper":
          return have($item`Eight Days a Week Pill Keeper`);
        case "pool":
          return get("_poolGames") < 3;
        case "swim":
          return !get("_olympicSwimmingPool");
        case "shower":
          return !get("_aprilShower");
        case "terminal":
          return (
            get("_sourceTerminalEnhanceUses") <
            1 +
              get("sourceTerminalChips")
                .split(",")
                .filter((s) => s.includes("CRAM")).length
          );
        case "daycare":
          return get("daycareOpen") && !get("_daycareSpa");
        default:
          return true; // Whatever edge cases we have not handled yet, just try to acquire it
      }
    })
    .some((b) => b);
}

export function tryAcquiringEffect(ef: Effect, tryRegardless = false): void {
  // Try acquiring an effect
  if (have(ef)) return;
  // If we already have the effect, we're done
  else if (forbiddenEffects.includes(ef)) return; // Don't acquire the effect if we are saving it

  if (ef === $effect`Sparkling Consciousness`) {
    // This has no ef.default for some reason
    if (holiday() === "Dependence Day" && !get("_fireworkUsed") && retrieveItem($item`sparkler`, 1))
      use($item`sparkler`, 1);
    return;
  } else if (ef === $effect`Empathy`) {
    if (!have($skill`Empathy of the Newt`)) return;
    const currentOffhandItem = equippedItem($slot`offhand`);
    if (currentOffhandItem === $item`April Shower Thoughts shield`) unequip($slot`offhand`);
    cliExecute("cast Empathy of the Newt");
    if (currentOffhandItem === $item`April Shower Thoughts shield`)
      equip($slot`offhand`, currentOffhandItem);
    return;
  }
  if (improvedShowerSkills.has(ef)) {
    const sk = improvedShowerSkills.get(ef) ?? $skill.none;
    if (!have($item`April Shower Thoughts shield`) || !have(sk)) return;
    const currentOffhandItem = equippedItem($slot`offhand`);
    if (currentOffhandItem !== $item`April Shower Thoughts shield`)
      equip($slot`offhand`, $item`April Shower Thoughts shield`);
    cliExecute(`cast ${sk}`);
    if (currentOffhandItem !== $item`April Shower Thoughts shield`)
      equip($slot`offhand`, currentOffhandItem);
    return;
  }
  if (!ef.default) return; // No way to acquire?

  if (ef === $effect`Ode to Booze`) restoreMp(60);
  if (tryRegardless || canAcquireEffect(ef)) {
    const efDefault = ef.default;
    if (efDefault.split(" ")[0] === "cargo") return; // Don't acquire effects with cargo (items are usually way more useful)
    const usePowerfulGlove =
      efDefault.includes("CHEAT CODE") &&
      have($item`Powerful Glove`) &&
      !haveEquipped($item`Powerful Glove`);
    const useHeartstone =
      efDefault.includes("Best Pals") ||
      (efDefault.includes("Ultraheart") &&
        have($item`Heartstone`) &&
        !haveEquipped($item`Heartstone`));
    const currentAcc3 = equippedItem($slot`acc3`);
    const currentAcc2 = equippedItem($slot`acc2`);
    if (usePowerfulGlove) equip($slot`acc3`, $item`Powerful Glove`);
    if (useHeartstone) equip($slot`acc2`, $item`Heartstone`);
    cliExecute(efDefault.replace(/cast 1 /g, "cast "));
    if (usePowerfulGlove) equip($slot`acc3`, currentAcc3);
    if (useHeartstone) equip($slot`acc2`, currentAcc2);
  }
}

/**
 * Losing a combat inflicts Beaten Up (heavy stat penalties). For pearlo that
 * always means the damage/defense plan failed — continuing would burn 2-adventure
 * underwater turns while crippled, so fail loudly instead.
 */
export function abortIfBeatenUp(context: string): void {
  if (have($effect`Beaten Up`)) {
    abort(
      `pearlo: Beaten Up ${context} — a fight was lost. Check HP, damage plan, and restores before rerunning.`,
    );
  }
}

// Owned single-use Beaten Up cures, cheapest first (SGEEA last — it cures anything,
// don't waste one when a tiny house would do).
const BEATEN_UP_CURES = $items`tiny house, CSA all-purpose soap, soft green echo eyedrop antidote`;

function hotTubAvailable(): boolean {
  return have($item`Clan VIP Lounge key`) && get("_hotTubSoaks") < 5;
}

function walrusCastable(): boolean {
  return have($skill`Tongue of the Walrus`) && myMp() >= mpCost($skill`Tongue of the Walrus`);
}

/**
 * Whether cureBeatenUp() would succeed right now. Free/owned resources only (no
 * mall buys) — used to decide if the June cleaver's Poetic Justice +5-adventure
 * option (which inflicts Beaten Up) is safe to take.
 */
export function canCureBeatenUp(): boolean {
  return walrusCastable() || hotTubAvailable() || BEATEN_UP_CURES.some((cure) => have(cure));
}

/**
 * Remove Beaten Up using owned/free resources only: Tongue of the Walrus, then a
 * VIP hot tub soak (also a full heal, 5/day), then owned single-use cures. Not
 * libram's uneffect(): that shells out to mafia's `uneffect`, which may buy a
 * remedy — pearlo's default policy is free/owned resources only.
 */
export function cureBeatenUp(): boolean {
  const beatenUp = $effect`Beaten Up`;
  if (have(beatenUp) && walrusCastable()) useSkill($skill`Tongue of the Walrus`);
  if (have(beatenUp) && hotTubAvailable()) cliExecute("hottub");
  for (const cure of BEATEN_UP_CURES) {
    if (!have(beatenUp)) break;
    if (have(cure)) use(cure);
  }
  return !have(beatenUp);
}

/**
 * Post-combat Beaten Up triage. The June cleaver's Poetic Justice NC (choice 1467,
 * option 3) grants +5 adventures at the cost of Beaten Up (5 turns, −50% all stats)
 * — taken deliberately (see PearloEngine.setChoices), and turn-free, so grimoire
 * re-adventures through it and the effect surfaces in post() after a *won* fight.
 * Attribution: 1467 can only fire while absent from mafia's juneCleaverQueue and
 * fires into it, so absent-before/present-after identifies it exactly; a lost fight
 * additionally leaves HP at 0, which Poetic Justice never does.
 */
export function handlePostCombatBeatenUp(context: string, cleaverQueueBefore: string): void {
  if (!have($effect`Beaten Up`)) return;
  const queueNow = get("juneCleaverQueue");
  const poeticJusticeFired =
    !cleaverQueueBefore.includes("1467") && queueNow.includes("1467") && myHp() > 0;
  if (!poeticJusticeFired) abortIfBeatenUp(context);
  if (!cureBeatenUp()) {
    abort(
      "pearlo: Beaten Up from the June cleaver's Poetic Justice (+5 advs) and no owned cure " +
        "worked (Tongue of the Walrus / VIP hot tub / tiny house / CSA soap / SGEEA). " +
        "Cure it manually before rerunning — fighting at −50% stats breaks the damage plan.",
    );
  }
  print("pearlo: cured Beaten Up from the June cleaver's Poetic Justice (+5 adventures).", "blue");
}

export function isLiverCapped(): boolean {
  return myInebriety() >= inebrietyLimit();
}
export function isStomachCapped(): boolean {
  return myFullness() >= fullnessLimit();
}
export function isSpleenCapped(): boolean {
  return mySpleenUse() >= spleenLimit();
}

export function isOverDrunk(): boolean {
  return myInebriety() > inebrietyLimit();
}
