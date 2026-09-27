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
import { requiredAttackFor, weaponAttackPlan, wineglassAccessible } from "./combat";
import {
  chooseLiverConfiguration,
  overrideReportLines,
  primeZoneVerdicts,
  printProfitReport,
  zoneVerdict,
} from "./economics";
import { PearloEngine } from "./engine";
import { predictedPlayerAirByEffect } from "./familiar";
import { freeFishyReport, luckySourceReport } from "./fishy";
import { castSharedResBuffs, uncastResBuffBonus } from "./mood";
import {
  allOrganEquipment,
  canFixOvercap,
  organStatusReport,
  requiredOrganEquipment,
  setLiverMode,
  wineglassMode,
  liverMode,
} from "./organs";
import {
  pearlAvoidTerms,
  pearlDamagePlan,
  pearlForcedEquipment,
  pearlOutfitWeights,
  pearlResObjective,
} from "./outfit";
import { pearlTasks } from "./pearls";
import { canBreathUnderwater } from "./zones";

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
  const reportOnly = args.sim || args.profit;
  if (!reportOnly) {
    // Abort before the buff pass spends anything on a day that cannot farm at all.
    if (!canFixOvercap()) {
      abort(
        "pearlo: stomach or spleen is overcapped beyond what owned extenders can fix — " +
          "adventuring is impossible (Food Coma / jaundiced). Use a mojo filter or organ " +
          "cleaners, or wait for rollover.",
      );
    }
    // Before anything is priced: the profit model speculates maximizes, and those only
    // reflect resistance that is actually up, so casting the shared buffs first is what
    // makes the estimate match the outfit the run will really dress. Report-only
    // invocations spend nothing, so they price against whatever is already running.
    castSharedResBuffs(selected);
  }
  if (args.drunk && reportOnly) setLiverMode("wineglass");
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
    print(freeFishyReport());
    for (const line of luckySourceReport()) print(line);
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
      const obtained = get(spec.obtained) ? " (already obtained today — will not farm)" : "";
      print(
        `  ${spec.key}: res ${v.res}${v.potionCost > 0 ? ` (incl. ${Math.round(v.potionCost)} meat of potions)` : ""} → ${v.ratePct.toFixed(1)}%/fight — expected profit ${Math.round(v.profit)} meat — ${v.go ? "GO" : "SKIP"}${obtained}`,
        v.go ? "blue" : "red",
      );
      const uncast = uncastResBuffBonus(spec);
      if (uncast > 0) {
        print(
          `   note: +${uncast} res of castable free buffs is not active — a real run casts them before pricing, so this estimate is conservative.`,
        );
      }
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
    // Air is the run's *predicted* state: the Breathe Underwater cascade hasn't run
    // yet at sim time, but the real dress will happen after it has.
    const breathing = predictedPlayerAirByEffect() ? "" : ", adventure underwater";
    // Only force the wineglass into the speculation when it is actually reachable —
    // otherwise every combination FAILs on the +equip and the res verdict is garbage.
    const glassReachable = !simDrunk || wineglassAccessible();
    for (const p of selected) {
      print(` --- ${p.key} (${p.loc}) ---`, "blue");
      print(`  canAdventure: ${canAdventure(p.loc)}`);
      const mode = simDrunk ? "wineglass" : liverMode();
      if (simDrunk) {
        const simWeapon = have(args.major.drunkweapon) ? args.major.drunkweapon : undefined;
        const attack = weaponAttackPlan(p.maxDef, p.maxHp, simWeapon);
        const oneShotNote = attack.canOneShot
          ? ""
          : args.major.leroyjenkins
            ? " (leroyjenkins: would fight anyway)"
            : " (would halt; leroyjenkins overrides)";
        print(
          `  attack floor (${simWeapon ?? "equipped weapon"}, ${attack.ranged ? "ranged" : "melee"}) vs ${p.maxHp} HP: ${attack.damage} — ` +
            `hit ${attack.hitGuaranteed ? "guaranteed" : `NOT guaranteed (need ${requiredAttackFor(p.maxDef)} ${attack.ranged ? "Moxie" : "Muscle"} vs Def ${p.maxDef})`} — ` +
            `one-shot: ${attack.canOneShot}${oneShotNote}`,
          attack.canOneShot ? "blue" : "red",
        );
      } else {
        const plan = pearlDamagePlan(p, mode);
        print(
          `  saucegeyser floor (planned outfit) vs ${p.maxHp} HP: ${plan.perCast} → ${plan.casts} cast(s)/fight, ${plan.mpPerFight} MP/fight`,
        );
      }
      // Recommended equips mirror buildPearlOutfit's overdrunk weapon logic: the
      // drunkweapon is forced when owned and not displaced by a required totem, and
      // 'effective' only applies when no weapon is forced. No `18 min` here — with
      // damage weights in the expression the maximizer optimizes total score, so a
      // min flag reports FAIL on outfits that trade res for damage even when a
      // pure-res 18 exists. Reachability is the verdict lines' res floor above.
      // The same forced slots, weights and refusals buildPearlOutfit and the profit
      // model use, so the outfit this prints is the one the run would dress.
      // A closeted wineglass would make every combination fail the +equip, so leave it
      // out of the expression rather than print garbage.
      const forced = pearlForcedEquipment(p, mode, predictedPlayerAirByEffect).equip.filter(
        (i) => glassReachable || i !== $item`Drunkula's wineglass`,
      );
      const weaponForced =
        simDrunk && (forced.includes($item`angelbone totem`) || have(args.major.drunkweapon));
      const forcedTerms = forced.map((i) => `, +equip ${i}`).join("");
      const expr =
        `${pearlResObjective(p, simDrunk)}${breathing}` +
        `${forcedTerms}${pearlOutfitWeights(simDrunk, weaponForced)}${pearlAvoidTerms(p)}`;
      const overrideNote = outfitOverride(p.key) !== undefined ? " (ignores zone overrides)" : "";
      print(
        `  recommended equips (as the run would dress)${simDrunk && glassReachable ? " (wineglass in off-hand)" : ""}:${overrideNote}`,
        "blue",
      );
      for (const boost of maximize(expr, 0, 0, true, true)) {
        if (boost.command.startsWith("equip")) print(`   ${boost.display}`);
      }
    }
    return;
  }

  primeZoneVerdicts(selected);
  const remaining = selected.filter((spec) => !get(spec.obtained));
  for (const spec of remaining) {
    const verdict = zoneVerdict(spec);
    if (!verdict.go && !args.major.force) {
      print(
        `pearlo: skipping ${spec.key} (${spec.loc}) — expected profit ${Math.round(verdict.profit)} meat. Run with force to farm it anyway.`,
        "red",
      );
    }
  }
  // All-obtained days fall through: the engine still runs the non-farming tasks
  // (codpiece socketing) and every zone task is already completed().
  if (remaining.length === 0) {
    print("pearlo: every selected pearl is already obtained today — nothing to farm.", "blue");
  } else if (!args.major.force && remaining.every((s) => !zoneVerdict(s).go)) {
    print(
      "pearlo: every remaining zone fails the profit gate — nothing to farm (use force to override).",
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
