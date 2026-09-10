/**
 * The Lucky! notice. The effect is spent on a zone's Lucky noncombat instead of on a
 * pearl fight, so only a zone that has one is worth warning about, and the warning is
 * worth saying once rather than before every fight.
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

function runMood(g: Game, target: PearlSpec): void {
  g.mood.pearlMood(
    target,
    24,
    () => false,
    (fights) => fights,
  );
}

function notices(g: Game): string[] {
  return g.state.log.prints.filter((p) => p.includes("Lucky! is active"));
}

async function luckyGame(): Promise<Game> {
  return loadGame((t) => {
    standardScenario(t, { res: 18, fishyTurns: 40 });
    t.active("Lucky!", 1);
  });
}

describe("the Lucky! notice", () => {
  it("knows which pearl zones can spend Lucky!, and on what", async () => {
    // Razor, Scooter is one adventure whose name contains a comma, not two adventures.
    // Paired, so swapping the two zones' noncombats cannot pass.
    const g = await luckyGame();
    const lucky = g.zones.PEARLS.filter((p) => p.luckyNoncombat !== undefined);
    expect(lucky.map((p) => [`${p.loc}`, p.luckyNoncombat]).sort()).toEqual([
      ["Madness Reef", "Dragon the Line"],
      ["The Dive Bar", "Razor, Scooter"],
    ]);
  });

  it("says nothing in any zone that cannot spend Lucky!", async () => {
    const g = await luckyGame();
    for (const p of g.zones.PEARLS.filter((z) => z.luckyNoncombat === undefined)) runMood(g, p);
    expect(notices(g)).toHaveLength(0);
  });

  it("warns in every zone that can, naming that zone's own noncombat", async () => {
    const g = await luckyGame();
    const lucky = g.zones.PEARLS.filter((p) => p.luckyNoncombat !== undefined);
    for (const p of lucky) runMood(g, p);
    const said = notices(g);
    expect(said).toHaveLength(lucky.length);
    for (const p of lucky) {
      const line = said.find((l) => l.includes(`${p.loc}`));
      expect(line).toBeDefined();
      expect(line).toContain(`may be ${p.luckyNoncombat} instead of a pearl fight`);
      expect(line).toContain("Consider spending Lucky elsewhere first");
    }
  });

  it("says it once per zone, not before every fight", async () => {
    // pearlMood runs in each fight's prepare, and nothing changes until Lucky! is spent.
    // Over every lucky zone, so a latch keyed to one of them cannot pass.
    const g = await luckyGame();
    const lucky = g.zones.PEARLS.filter((p) => p.luckyNoncombat !== undefined);
    for (const p of lucky) {
      for (let i = 0; i < 3; i++) runMood(g, p);
    }
    expect(notices(g)).toHaveLength(lucky.length);
  });

  it("warns again once Lucky! has lapsed and come back, even from another zone", async () => {
    // Get Fishy spends Lucky! in The Brinier Deepers, which is no pearl zone and never
    // reaches here, so the lapse has to clear every zone's notice and not just this one.
    const g = await luckyGame();
    runMood(g, spec(g, "sleaze"));
    g.state.effects.delete(g.mocks.Effect.get("Lucky!"));
    runMood(g, spec(g, "stench"));
    g.state.effects.set(g.mocks.Effect.get("Lucky!"), 1);
    runMood(g, spec(g, "sleaze"));
    expect(notices(g)).toHaveLength(2);
  });

  it("defers to the Fishy refresh only when that refresh will spend the effect", async () => {
    // luckyfishy on and Fishy nearly gone means Get Fishy preempts this zone and spends
    // Lucky! in The Brinier Deepers, so there is nothing to warn about. Either the
    // refresh is off or Fishy has turns left, and the hazard is live again.
    const nearlyOut = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 1 });
      t.active("Lucky!", 1);
    });
    nearlyOut.args.resources.luckyfishy = true;
    runMood(nearlyOut, spec(nearlyOut, "sleaze"));
    expect(notices(nearlyOut)).toHaveLength(0);

    const fishyStocked = await luckyGame();
    fishyStocked.args.resources.luckyfishy = true;
    runMood(fishyStocked, spec(fishyStocked, "sleaze"));
    expect(notices(fishyStocked)).toHaveLength(1);

    const refreshOff = await loadGame((t) => {
      standardScenario(t, { res: 18, fishyTurns: 1 });
      t.active("Lucky!", 1);
    });
    refreshOff.args.resources.luckyfishy = false;
    runMood(refreshOff, spec(refreshOff, "sleaze"));
    expect(notices(refreshOff)).toHaveLength(1);
  });

  it("says nothing when Lucky! is not up at all", async () => {
    const g = await loadGame((t) => standardScenario(t, { res: 18, fishyTurns: 40 }));
    runMood(g, spec(g, "sleaze"));
    expect(notices(g)).toHaveLength(0);
  });
});
