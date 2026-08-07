import { Engine, Task } from "grimoire-kolmafia";
import {
  Location,
  Slot,
  equippedItem,
  haveEffect,
  myAdventures,
  myFamiliar,
  myHp,
  myMaxhp,
  myMaxmp,
  myMp,
  numericModifier,
  print,
} from "kolmafia";
import { $effect, $item, PropertiesManager, get } from "libram";

import { args } from "./args";
import { damagePlan } from "./combat";
import { canBreathUnderwater } from "./zones";

export class PearloEngine extends Engine<never, Task> {
  private prepReportDone = false;

  initPropertiesManager(manager: PropertiesManager): void {
    super.initPropertiesManager(manager);
    const bannedAutoRestorers = [
      "sleep on your clan sofa",
      "rest in your campaway tent",
      "rest at the chateau",
      "rest at your campground",
      "free rest",
    ]; // free rests are for closers
    const hpItems = get("hpAutoRecoveryItems")
      .split(";")
      .filter((s) => !bannedAutoRestorers.includes(s))
      .join(";");
    const mpItems = Array.from(
      new Set([...get("mpAutoRecoveryItems").split(";"), "doc galaktik's invigorating tonic"]),
    )
      .filter((s) => !bannedAutoRestorers.includes(s))
      .join(";");
    manager.set({
      autoSatisfyWithCloset: false,
      hpAutoRecovery: -0.05,
      mpAutoRecovery: -0.05,
      maximizerCombinationLimit: 0,
      hpAutoRecoveryItems: hpItems,
      mpAutoRecoveryItems: mpItems,
    });
  }

  available(task: Task): boolean {
    // debug.prep: after the one prep report, stop scheduling anything.
    if (this.prepReportDone) return false;
    return super.available(task);
  }

  do(task: Task): void {
    // debug.prep: run non-adventuring dos (the breathing task IS prep), but stop at
    // the adventure itself and show what everything looks like.
    if (args.debug.prep && task.do instanceof Location) {
      this.printPrepReport(task.do);
      this.prepReportDone = true;
      return;
    }
    super.do(task);
  }

  private printPrepReport(loc: Location): void {
    const plan = damagePlan();
    print(`pearlo prep report — stopped before adventuring in ${loc}:`, "blue");
    print(` familiar: ${myFamiliar()}`);
    for (const slot of Slot.all()) {
      const item = equippedItem(slot);
      if (item !== $item.none) print(`  ${slot}: ${item}`);
    }
    for (const element of ["Hot", "Cold", "Spooky", "Stench", "Sleaze"]) {
      print(` ${element} res: ${numericModifier(`${element} Resistance`)}`);
    }
    print(` HP ${myHp()}/${myMaxhp()}, MP ${myMp()}/${myMaxmp()}`);
    print(` Fishy turns: ${haveEffect($effect`Fishy`)}`);
    print(` can breathe underwater: ${canBreathUnderwater()}`);
    print(
      ` saucegeyser floor (as dressed): ${plan.perCast} → ${plan.casts} cast(s)/fight, ${plan.mpPerFight} MP/fight`,
    );
    print(` adventures available: ${myAdventures()} (none spent)`);
  }
}
