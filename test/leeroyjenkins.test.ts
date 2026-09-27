/**
 * The overdrunk one-shot halt and its override. Wineglass combat is attack-only, so
 * by default a zone's prepare aborts unless the wielded weapon is sure to one-shot the
 * zone's toughest monster. `leeroyjenkins` charges in anyway: the halt becomes a
 * warning and the fight proceeds.
 */
import { describe, expect, it } from "vitest";

import { Game, loadGame, standardScenario } from "./support/harness";

/**
 * Overdrunk in the Briniest Deepests with the standard fake's Muscle 1000 against
 * Def 360 / 800 HP: the hit is guaranteed but the damage floor is 640, short of 800.
 */
async function overdrunkZone(): Promise<{ g: Game; prepare: () => void }> {
  const g = await loadGame((t) => {
    standardScenario(t, { res: 18, fishyTurns: 40 });
    t.item("Drunkula's wineglass", { count: 1 });
    t.state.equipped.set(t.mocks.Slot.get("weapon"), t.mocks.Item.get("June cleaver"));
    t.state.itemMods.set(t.mocks.Item.get("June cleaver"), { Power: 100 });
  });
  g.organs.setLiverMode("wineglass");
  const cold = g.zones.PEARLS.find((p) => p.key === "cold");
  if (!cold) throw new Error("no cold spec");
  const task = g.pearls.pearlTasks([cold]).find((x) => x.name === `${cold.loc}`);
  if (!task?.prepare) throw new Error("no prepare");
  return { g, prepare: task.prepare.bind(task) };
}

describe("overdrunk one-shot halt", () => {
  it("halts when the weapon cannot guarantee the one-shot", async () => {
    const { prepare } = await overdrunkZone();
    expect(() => prepare()).toThrow(/can't guarantee a one-shot/);
  });

  it("leeroyjenkins turns the halt into a warning and fights anyway", async () => {
    const { g, prepare } = await overdrunkZone();
    g.args.major.leeroyjenkins = true;
    expect(() => prepare()).not.toThrow();
    expect(g.state.log.prints.some((l) => /leeroyjenkins/.test(l))).toBe(true);
  });
});
