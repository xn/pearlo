import { Args, getTasks } from "grimoire-kolmafia";
import {
  abort,
  canAdventure,
  getOutfits,
  haveOutfit,
  maximize,
  myAdventures,
  myMeat,
  myTurncount,
  print,
} from "kolmafia";
import { $item, get, have, sinceKolmafiaRevision } from "libram";

import { args, outfitOverride, selectedPearls } from "./args";
import {
  damagePlan,
  ownedLanternProspect,
  requiredAttackFor,
  weaponAttackPlan,
  wineglassAccessible,
} from "./combat";
import {
  chooseLiverConfiguration,
  overrideReportLines,
  primeZoneVerdicts,
  printProfitReport,
  zoneVerdict,
} from "./economics";
import { PearloEngine } from "./engine";
import { playerAirByEffect } from "./familiar";
import {
  allOrganEquipment,
  canFixOvercap,
  organStatusReport,
  requiredOrganEquipment,
  setLiverMode,
  wineglassMode,
} from "./organs";
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
  // Zone Overrides validation: a saved-outfit name that doesn't exist would otherwise
  // surface as a confusing empty-pieces dress much later.
  for (const spec of selected) {
    const outfitName = outfitOverride(spec.key);
    if (outfitName !== undefined && !haveOutfit(outfitName)) {
      abort(
        `pearlo: ${spec.key} outfit override "${outfitName}" is not a saved custom outfit ` +
          `(saved outfits: ${getOutfits().join(", ") || "none"})`,
      );
    }
  }
  // Liver mode is chosen once — organ state doesn't change mid-run (pearlo neither
  // eats nor drinks). The drunk flag is a what-if override for sim/profit reporting
  // only — it must never leak into a real (turn-spending) run.
  if (args.drunk && (args.sim || args.profit)) setLiverMode("wineglass");
  else chooseLiverConfiguration(selected);

  if (args.profit) {
    if (!canFixOvercap()) {
      print(
        "pearlo: stomach/spleen overcapped beyond owned extenders — the run would halt.",
        "red",
      );
    }
    primeZoneVerdicts(selected);
    printProfitReport(selected);
    return;
  }

  if (args.sim) {
    const simDrunk = wineglassMode();
    print(`pearlo sim${simDrunk ? " (overdrunk mode)" : ""}:`, "blue");
    print(` pearls selected: ${selected.map((p) => p.key).join(", ")}`);
    print(` can breathe underwater: ${canBreathUnderwater()}`);
    print(` adventures available: ${myAdventures()}`);
    for (const line of organStatusReport()) print(line);
    {
      const forced = args.major.overcapped ? allOrganEquipment() : requiredOrganEquipment();
      print(
        ` forced organ equipment${args.major.overcapped ? " (overcapped flag: full set)" : ""}: ${forced.length > 0 ? forced.join(", ") : "none"}`,
      );
    }
    primeZoneVerdicts(selected);
    for (const spec of selected) {
      const v = zoneVerdict(spec);
      print(
        `  ${spec.key}: expected profit ${Math.round(v.profit)} meat — ${v.go ? "GO" : "SKIP"}`,
        v.go ? "blue" : "red",
      );
      for (const line of overrideReportLines(spec)) print(line);
    }
    if (!canFixOvercap()) {
      print(
        " stomach/spleen overcapped beyond owned extenders — the run would halt (mojo filter / organ cleaners / rollover).",
        "red",
      );
    }
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
      const overrideNote = outfitOverride(p.key) !== undefined ? " (ignores zone overrides)" : "";
      print(
        `  ${PEARL_RES_CAP} res ${capMet ? "reachable" : "NOT reachable"}${wineglass ? " (wineglass in off-hand)" : ""} — recommended equips:${overrideNote}`,
        capMet ? "blue" : "red",
      );
      for (const boost of maximize(expr, 0, 0, true, true)) {
        if (boost.command.startsWith("equip")) print(`   ${boost.display}`);
      }
    }
    return;
  }

  if (!canFixOvercap()) {
    abort(
      "pearlo: stomach or spleen is overcapped beyond what owned extenders can fix — " +
        "adventuring is impossible (Food Coma / jaundiced). Use a mojo filter or organ " +
        "cleaners, or wait for rollover.",
    );
  }
  primeZoneVerdicts(selected);
  for (const spec of selected) {
    const verdict = zoneVerdict(spec);
    if (!verdict.go && !args.major.force) {
      print(
        `pearlo: skipping ${spec.key} (${spec.loc}) — expected profit ${Math.round(verdict.profit)} meat. Run with force to farm it anyway.`,
        "red",
      );
    }
  }
  if (!args.major.force && selected.every((s) => !zoneVerdict(s).go)) {
    print(
      "pearlo: every selected zone fails the profit gate — nothing to farm (use force to override).",
      "red",
    );
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
      } else if (!zoneVerdict(p).go && !args.major.force) {
        print(` ${p.key}: skipped by the profit gate (expected loss)`);
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
