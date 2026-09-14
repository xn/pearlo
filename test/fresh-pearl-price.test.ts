/**
 * mafia answers mallPrice from prices it read earlier in the same rollover day, even
 * across restarts, so the pearl has to be re-searched before the model values it.
 */
import { describe, expect, it } from "vitest";

import type { PearlSpec } from "../src/zones";

import { Game, Tools, loadGame, standardScenario } from "./support/harness";

function spec(g: Game, key: string): PearlSpec {
  const found = g.zones.PEARLS.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} spec`);
  return found;
}

/** A 70k reading `ageDays` old, while the mall now sells at 80k. */
function stalePrice(t: Tools, ageDays = 0.18): void {
  // VOA 6,500 and 10 Fishy fights: 65,000 of turns against the pearl's sale value.
  standardScenario(t, { res: 18, voa: 6500, fishyTurns: 10, pearlValue: 63_000 });
  const pearl = t.item("unblemished pearl", { mall: 70_000 });
  t.state.mallPriceAges.set(pearl, ageDays);
}

function mallMovedTo80k(t: Tools): void {
  t.state.mallSearchHandlers.set(t.item("unblemished pearl"), () => {
    t.item("unblemished pearl", { mall: 80_000, sale: 72_000 });
  });
}

describe("the pearl's value", () => {
  it("is SKIP on the cached morning price", async () => {
    const g = await loadGame((t) => stalePrice(t));
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.turns).toBe(10);
    expect(v.profit).toBe(63_000 - 65_000);
    expect(v.go).toBe(false);
  });

  it("comes from a live mall search, which flips the zone to GO", async () => {
    const g = await loadGame((t) => {
      stalePrice(t);
      mallMovedTo80k(t);
    });
    expect(g.economics.pearlValue()).toBe(72_000);
    const v = g.economics.zoneVerdict(spec(g, "cold"));
    expect(v.profit).toBe(72_000 - 65_000);
    expect(v.go).toBe(true);
    const pearl = g.item("unblemished pearl");
    expect(g.state.log.mallSearches).toEqual([{ item: pearl, maxAge: 0 }]);
  });

  it("re-searches a price read only minutes ago", async () => {
    const g = await loadGame((t) => {
      stalePrice(t, 0.01);
      mallMovedTo80k(t);
    });
    expect(g.economics.pearlValue()).toBe(72_000);
  });

  it("searches once per run, only for the pearl, and only when pricing starts", async () => {
    const g = await loadGame((t) => {
      stalePrice(t);
      mallMovedTo80k(t);
      t.item("Oil of Parafin", { mall: 5_000, sale: 4_000 });
    });
    expect(g.state.log.mallSearches).toHaveLength(0);
    g.economics.garboValue(g.item("Oil of Parafin"));
    expect(g.state.log.mallSearches).toHaveLength(0);
    g.economics.primeZoneVerdicts(g.zones.PEARLS);
    g.economics.primeZoneVerdicts(g.zones.PEARLS);
    g.economics.pearlValue();
    expect(g.state.log.mallSearches).toHaveLength(1);
  });

  it("warns when the mall search finds no price", async () => {
    const g = await loadGame((t) => {
      standardScenario(t, { res: 18, voa: 6500, fishyTurns: 10 });
    });
    g.economics.pearlValue();
    expect(g.state.log.prints.some((p) => p.includes("found no price"))).toBe(true);
  });

  it("warns when the search finds no listing, which mafia records as -1", async () => {
    const g = await loadGame((t) => {
      stalePrice(t);
      t.state.mallSearchHandlers.set(t.item("unblemished pearl"), () => {
        t.item("unblemished pearl", { mall: -1 });
      });
    });
    g.economics.pearlValue();
    expect(g.state.log.prints.some((p) => p.includes("found no price"))).toBe(true);
  });

  it("stays quiet when the search prices the pearl", async () => {
    const g = await loadGame((t) => {
      stalePrice(t);
      mallMovedTo80k(t);
    });
    g.economics.pearlValue();
    expect(g.state.log.prints.some((p) => p.includes("found no price"))).toBe(false);
  });
});
