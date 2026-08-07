import { Args, getTasks } from "grimoire-kolmafia";
import { canAdventure, myAdventures, myMeat, myTurncount, print } from "kolmafia";
import { get, sinceKolmafiaRevision } from "libram";

import { args, selectedPearls } from "./args";
import { damagePlan, ownedLanternProspect } from "./combat";
import { PearloEngine } from "./engine";
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
  if (args.sim) {
    const plan = damagePlan(undefined, ownedLanternProspect());
    print("pearlo sim:", "blue");
    print(` pearls selected: ${selected.map((p) => p.key).join(", ")}`);
    print(` can breathe underwater: ${canBreathUnderwater()}`);
    for (const p of selected) print(` canAdventure(${p.loc}): ${canAdventure(p.loc)}`);
    print(
      ` saucegeyser floor (best gear): ${plan.perCast} → ${plan.casts} cast(s)/fight, ${plan.mpPerFight} MP/fight`,
    );
    print(` adventures available: ${myAdventures()}`);
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
