/**
 * Issue #13: the Fishy trips (The Haggling, Lutz) dressed for breathing alone, so the
 * dress stripped the organ extenders the zone outfits force. Overfull or overspleened,
 * the next adventure is Food Coma / jaundice, the abort macro only catches combats,
 * and the trip's soft limit let it repeat ten times. The trip outfit has to carry the
 * same "still able to adventure" layer as the zones: organ extenders, the wineglass
 * while overdrunk, the Stooper pin while its +1 is the liver rescue.
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, Tools, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

/** A day the Lucky! refresh is the Fishy source: gear air, a clover, Lutz dined. */
function refreshDay(t: Tools): void {
  standardScenario(t, { res: 18 });
  t.item("aerated diving helmet", { count: 1 });
  t.prop("_subAquaEquipBreathing", true);
  t.state.playerMods["Adventure Underwater"] = true;
  t.item("11-leaf clover", { count: 1, effect: "Lucky!", duration: 1 });
  t.prop("skateParkStatus", "ice");
  t.prop("_skateBuff1", true);
}

async function refreshGame(configure: (t: Tools) => void): Promise<Game> {
  const g = await loadGame((t) => {
    refreshDay(t);
    configure(t);
  });
  g.args.resources.luckyfishy = true;
  return g;
}

function task(g: Game, name: string) {
  const found = g.pearls.pearlTasks([spec(g, "cold")]).find((x) => x.name === name);
  if (found === undefined) throw new Error(`no ${name} task`);
  return found;
}

function outfitOf(t: { outfit?: unknown }): Record<string, unknown> {
  if (typeof t.outfit !== "function") throw new Error("expected an outfit() function");
  return (t.outfit as () => Record<string, unknown>)();
}

function equipNames(outfit: Record<string, unknown>): string[] {
  return ((outfit.equip as unknown[] | undefined) ?? []).map(String);
}

describe("the Fishy trip keeps the organs legal (issue #13)", () => {
  it("wears the stomach extender when a meal sits over the baseline", async () => {
    const g = await refreshGame((t) => {
      t.state.fullness = 16; // baseline 15: one over, one chopstick fixes it
      t.item("angelbone chopsticks", { count: 1 });
    });
    const outfit = outfitOf(task(g, "Get Fishy"));
    expect(equipNames(outfit)).toContain("angelbone chopsticks");
    expect(outfit.modifier).toBe("adventure underwater");
  });

  it("wears the spleen extender when spleen sits over the baseline", async () => {
    const g = await refreshGame((t) => {
      t.state.spleenUse = 16;
      t.item("angelbone totem", { count: 1 });
    });
    expect(equipNames(outfitOf(task(g, "Get Fishy")))).toContain("angelbone totem");
  });

  it("asks for no organ gear at all while every organ is within baseline", async () => {
    const g = await refreshGame((t) => {
      t.item("angelbone chopsticks", { count: 1 });
      t.item("angelbone totem", { count: 1 });
    });
    expect(equipNames(outfitOf(task(g, "Get Fishy")))).toEqual([]);
  });

  it("forces the full owned set under the overcapped flag, like the zones do", async () => {
    const g = await refreshGame((t) => {
      t.item("angelbone chopsticks", { count: 1 });
      t.item("angelbone totem", { count: 1 });
    });
    g.args.major.overcapped = true;
    const names = equipNames(outfitOf(task(g, "Get Fishy")));
    expect(names).toContain("angelbone chopsticks");
    expect(names).toContain("angelbone totem");
  });

  it("wears the wineglass while overdrunk beyond rescue", async () => {
    const g = await refreshGame((t) => {
      t.state.inebriety = 17; // limit 15, no extenders, no Stooper: wineglass mode
      t.item("Drunkula's wineglass", { count: 1 });
    });
    expect(g.organs.liverMode()).toBe("wineglass");
    expect(equipNames(outfitOf(task(g, "Get Fishy")))).toContain("Drunkula's wineglass");
  });

  it("keeps Stooper, with its boot, while its +1 is the liver rescue", async () => {
    const g = await refreshGame((t) => {
      t.state.inebriety = 16; // one over; no dice owned, so only Stooper rescues it
      t.familiar("Stooper", { owned: true });
      t.item("das boot", { count: 1 });
    });
    expect(g.organs.liverMode()).toBe("stooper");
    const outfit = outfitOf(task(g, "Get Fishy"));
    expect(String(outfit.familiar)).toBe("Stooper");
    expect(String(outfit.famequip)).toBe("das boot");
  });

  it("dresses the Lutz visit with the same organ gear", async () => {
    const g = await refreshGame((t) => {
      t.prop("_skateBuff1", false);
      t.state.fullness = 16;
      t.item("angelbone chopsticks", { count: 1 });
    });
    expect(equipNames(outfitOf(task(g, "Lutz Fishy")))).toContain("angelbone chopsticks");
  });
});

describe("the Fishy trip refuses to adventure into Food Coma", () => {
  function prepare(t: { prepare?: unknown }): void {
    if (typeof t.prepare !== "function") throw new Error("expected a prepare() function");
    (t.prepare as () => void)();
  }

  it("halts before spending a Lucky! source when the dress left the stomach over cap", async () => {
    // Nothing owned can fix the overage, so whatever was dressed, fullness > limit.
    const g = await refreshGame((t) => {
      t.state.fullness = 16;
    });
    expect(() => prepare(task(g, "Get Fishy"))).toThrow(/Food Coma/);
    expect(g.state.log.uses).toEqual([]);
  });

  it("halts the same way for a jaundiced spleen", async () => {
    const g = await refreshGame((t) => {
      t.state.spleenUse = 16;
    });
    expect(() => prepare(task(g, "Get Fishy"))).toThrow(/jaundice/);
    expect(g.state.log.uses).toEqual([]);
  });

  it("goes ahead and takes the clover once the organs are legal", async () => {
    const g = await refreshGame(() => undefined);
    prepare(task(g, "Get Fishy"));
    expect(g.state.log.uses.map((u) => String(u.item))).toEqual(["11-leaf clover"]);
  });
});
