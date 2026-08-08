import {
  Item,
  fullnessLimit,
  haveEquipped,
  inebrietyLimit,
  myFamiliar,
  myFullness,
  myInebriety,
  mySpleenUse,
  spleenLimit,
} from "kolmafia";
import { $familiar, $item, have } from "libram";

export type Organ = "stomach" | "liver" | "spleen";

/**
 * Liver play mode (spec: "chosen configuration is the single source of truth").
 * "sober": inebriety within the no-gear baseline. "items"/"stooper": over baseline but
 * rescued back under the effective limit by liver extenders (plus Stooper's +1 for
 * "stooper") — spell combat works. "wineglass": drunk beyond rescue, attack-only.
 * src/economics.ts chooses and sets the mode at startup; the fallback computation in
 * liverMode() only covers contexts that run before the chooser.
 */
export type LiverMode = "sober" | "items" | "stooper" | "wineglass";

// 2026 Standard rewards, +1 capacity while equipped (wiki data pages, 2026-08-08).
// Preference order: angelbone first — no +13 ML (bonus ML feeds stun resistance and
// monster stats, docs/sea-reference.md §6) and no shirt cost (corset competes with the
// Jurassic Parka).
const STOMACH_EXTENDERS = [$item`angelbone chopsticks`, $item`devilbone corset`];
const LIVER_EXTENDERS = [$item`angelbone dice`, $item`devilbone rosary`];
// totem = 1-handed weapon, greaves = pants. Sober spell combat leaves the weapon slot
// cheap (totem first); wineglass combat needs it for the drunkweapon (greaves first,
// totem only as a required last resort — best-effort attack combat, user decision).
const SPLEEN_EXTENDERS_SOBER = [$item`angelbone totem`, $item`devilbone greaves`];
const SPLEEN_EXTENDERS_WINEGLASS = [$item`devilbone greaves`, $item`angelbone totem`];

let chosenLiverMode: LiverMode | undefined;

export function setLiverMode(mode: LiverMode | undefined): void {
  chosenLiverMode = mode;
}

export function liverMode(): LiverMode {
  if (chosenLiverMode !== undefined) return chosenLiverMode;
  if (overage("liver") === 0) return "sober";
  if (effectivelyOverDrunk()) return "wineglass";
  // Explicit mode argument — ownedExtenders' default parameter is liverMode(), so
  // letting it default here would recurse forever. The liver list is mode-independent.
  if (ownedExtenders("liver", "sober").length >= overage("liver")) return "items";
  return have($familiar`Stooper`) ? "stooper" : "wineglass";
}

export function wineglassMode(): boolean {
  return liverMode() === "wineglass";
}

function extenders(organ: Organ, mode: LiverMode): Item[] {
  switch (organ) {
    case "stomach":
      return STOMACH_EXTENDERS;
    case "liver":
      return LIVER_EXTENDERS;
    case "spleen":
      return mode === "wineglass" ? SPLEEN_EXTENDERS_WINEGLASS : SPLEEN_EXTENDERS_SOBER;
  }
}

export function ownedExtenders(organ: Organ, mode: LiverMode = liverMode()): Item[] {
  return extenders(organ, mode).filter((i) => have(i));
}

function equippedExtenderCount(organ: Organ): number {
  return extenders(organ, "sober").filter((i) => haveEquipped(i)).length;
}

/** The organ limit with every equipped extender's +1 (and Stooper's, for liver) stripped. */
export function baselineLimit(organ: Organ): number {
  switch (organ) {
    case "stomach":
      return fullnessLimit() - equippedExtenderCount("stomach");
    case "liver":
      return (
        inebrietyLimit() -
        equippedExtenderCount("liver") -
        (myFamiliar() === $familiar`Stooper` ? 1 : 0)
      );
    case "spleen":
      return spleenLimit() - equippedExtenderCount("spleen");
  }
}

function organUsage(organ: Organ): number {
  switch (organ) {
    case "stomach":
      return myFullness();
    case "liver":
      return myInebriety();
    case "spleen":
      return mySpleenUse();
  }
}

/** How far past the no-gear baseline this organ currently is. */
export function overage(organ: Organ): number {
  return Math.max(0, organUsage(organ) - baselineLimit(organ));
}

/** Drunk beyond any conceivable rescue (items + Stooper) — wineglass mode is certain. */
export function effectivelyOverDrunk(): boolean {
  return (
    myInebriety() >
    baselineLimit("liver") +
      LIVER_EXTENDERS.filter((i) => have(i)).length +
      (have($familiar`Stooper`) ? 1 : 0)
  );
}

/**
 * Minimal owned equipment that makes every organ legal for adventuring. Stomach/spleen
 * overcap (Food Coma / jaundiced) blocks adventuring entirely, so their extenders are
 * mandatory — flag or no flag. Liver extenders appear only in the rescue modes; in
 * wineglass mode they are dead slots (user rule: more overdrunk than extenders can
 * handle → adventure via wineglass instead).
 */
export function requiredOrganEquipment(mode: LiverMode = liverMode()): Item[] {
  const required: Item[] = [
    ...ownedExtenders("stomach", mode).slice(0, overage("stomach")),
    ...ownedExtenders("spleen", mode).slice(0, overage("spleen")),
  ];
  if (mode === "items" || mode === "stooper") {
    const fromStooper = mode === "stooper" ? 1 : 0;
    required.push(
      ...ownedExtenders("liver", mode).slice(0, Math.max(0, overage("liver") - fromStooper)),
    );
  }
  return required;
}

/**
 * Every owned extender, for the `overcapped` flag (max consumption headroom while
 * running turns) — minus wineglass-mode dead weight: liver extenders always, and the
 * totem unless it is actually required (the drunkweapon owns the weapon slot).
 */
export function allOrganEquipment(mode: LiverMode = liverMode()): Item[] {
  const required = requiredOrganEquipment(mode);
  const all = [
    ...ownedExtenders("stomach", mode),
    ...ownedExtenders("spleen", mode),
    ...ownedExtenders("liver", mode),
  ];
  return all.filter((i) => {
    if (required.includes(i)) return true;
    if (mode !== "wineglass") return true;
    if (LIVER_EXTENDERS.includes(i)) return false;
    if (i === $item`angelbone totem`) return false;
    return true;
  });
}

/** Stomach/spleen overages coverable by owned extenders? False → nothing can adventure. */
export function canFixOvercap(): boolean {
  return (
    overage("stomach") <= ownedExtenders("stomach").length &&
    overage("spleen") <= ownedExtenders("spleen").length
  );
}

/** Human-readable organ state for sim/profit output. */
export function organStatusReport(): string[] {
  const organs: Organ[] = ["stomach", "liver", "spleen"];
  const lines = organs.map((organ) => {
    const over = overage(organ);
    const owned = ownedExtenders(organ);
    return ` ${organ}: ${organUsage(organ)} used / ${baselineLimit(organ)} baseline${
      over > 0 ? ` — OVER by ${over}` : ""
    } (extenders owned: ${owned.length > 0 ? owned.join(", ") : "none"})`;
  });
  lines.push(` liver mode: ${liverMode()}`);
  return lines;
}
