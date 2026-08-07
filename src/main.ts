import { Args, getTasks } from "grimoire-kolmafia";
import { canAdventure, maximize, myAdventures, myMeat, myTurncount, print } from "kolmafia";
import { $item, get, have, sinceKolmafiaRevision } from "libram";

import { args, selectedPearls } from "./args";
import {
  damagePlan,
  ownedLanternProspect,
  requiredAttackFor,
  weaponAttackPlan,
  wineglassAccessible,
} from "./combat";
import { PearloEngine } from "./engine";
import { playerAirByEffect } from "./familiar";
import { isOverDrunk } from "./lib";
import { pearlTasks } from "./pearls";
import { PEARL_RES_CAP, canBreathUnderwater } from "./zones";

export function main(command?: string): void {
  sinceKolmafiaRevision(28100);
  Args.fill(args, command);
  if (args.help) {
    Args.showHelp(args);
    return;
  }
  if (args.version) {
    print("pearlo v0.0.0");
    return;
  }
  const selected = selectedPearls();
  if (args.sim) {
    const simDrunk = args.drunk || isOverDrunk();
    print(`pearlo sim${simDrunk ? " (overdrunk mode)" : ""}:`, "blue");
    print(` pearls selected: ${selected.map((p) => p.key).join(", ")}`);
    print(` can breathe underwater: ${canBreathUnderwater()}`);
    print(` adventures available: ${myAdventures()}`);
    if (simDrunk && !have($item`Drunkula's wineglass`)) {
      print(" no Drunkula's wineglass — overdrunk farming would not run at all", "red");
    } else if (simDrunk && !wineglassAccessible()) {
      print(
        " Drunkula's wineglass is owned but NOT in inventory (closet/storage?) — neither the maximizer nor the dress can reach it there. Take it out first.",
        "red",
      );
    }
    // Per-element blocks (speculative — nothing is equipped; current familiar counts).
    const breathing = playerAirByEffect() ? "" : ", adventure underwater";
    // Only force the wineglass into the speculation when it is actually reachable —
    // otherwise every combination FAILs on the +equip and the res verdict is garbage.
    const wineglass = simDrunk && wineglassAccessible() ? ", +equip Drunkula's wineglass" : "";
    for (const p of selected) {
      print(` --- ${p.key} (${p.loc}) ---`, "blue");
      print(`  canAdventure: ${canAdventure(p.loc)}`);
      if (simDrunk) {
        const simWeapon = have(args.major.drunkweapon) ? args.major.drunkweapon : undefined;
        const attack = weaponAttackPlan(p.maxDef, p.maxHp, simWeapon);
        print(
          `  attack floor (${simWeapon ?? "equipped weapon"}, ${attack.ranged ? "ranged" : "melee"}) vs ${p.maxHp} HP: ${attack.damage} — ` +
            `hit ${attack.hitGuaranteed ? "guaranteed" : `NOT guaranteed (need ${requiredAttackFor(p.maxDef)} ${attack.ranged ? "Moxie" : "Muscle"} vs Def ${p.maxDef})`} — ` +
            `one-shot: ${attack.canOneShot}`,
          attack.canOneShot ? "blue" : "red",
        );
      } else {
        const plan = damagePlan(p.maxHp, ownedLanternProspect());
        print(
          `  saucegeyser floor (best gear) vs ${p.maxHp} HP: ${plan.perCast} → ${plan.casts} cast(s)/fight, ${plan.mpPerFight} MP/fight`,
        );
      }
      const combatWeights = simDrunk
        ? ", effective, 0.2 weapon damage, 0.2 weapon damage percent"
        : "";
      const expr = `${p.key} res ${PEARL_RES_CAP} max ${PEARL_RES_CAP} min${breathing}${wineglass}${combatWeights}`;
      const capMet = maximize(expr, true);
      print(
        `  ${PEARL_RES_CAP} res ${capMet ? "reachable" : "NOT reachable"}${wineglass ? " (wineglass in off-hand)" : ""} — recommended equips:`,
        capMet ? "blue" : "red",
      );
      for (const boost of maximize(expr, 0, 0, true, true)) {
        if (boost.command.startsWith("equip")) print(`   ${boost.display}`);
      }
    }
    return;
  }

  const startTurns = myTurncount();
  const startMeat = myMeat();
  const engine = new PearloEngine(getTasks([{ name: "Pearls", tasks: pearlTasks(selected) }]));
  try {
    engine.run();
  } finally {
    engine.destruct();
  }
  if (args.debug.prep && !engine.prepReported) {
    print("pearlo prep: no zone task ran — nothing to prep:", "red");
    for (const p of selected) {
      if (get(p.obtained)) {
        print(` ${p.key}: pearl already obtained today (resets at rollover)`);
      } else if (!canAdventure(p.loc)) {
        print(` ${p.key}: canAdventure(${p.loc}) is false`);
      } else {
        print(` ${p.key}: not ready (sober/turn-budget guard)`);
      }
    }
  }
  print(`pearlo: spent ${myTurncount() - startTurns} turns, meat ${myMeat() - startMeat}`, "blue");
  for (const p of selected) {
    print(` ${p.key}: obtained=${get(p.obtained)} progress=${get(p.progress, 0)}%`);
  }
}
