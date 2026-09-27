/**
 * weaponAttackPlan: the overdrunk (wineglass, attack-only) one-shot gate. A hit is
 * "guaranteed" either by out-statting the monster's Defense (wiki Hit_Chance) or by a
 * "Cannot miss" source — mafia's boolean modifier "Attacks Can't Miss", carried by the
 * June cleaver (the default drunkweapon), Thor's Pliers, the Red Fox glove, and effects
 * such as Comic Violence. Before this test, only the Muscle route counted, so a cleaver
 * user with modest Muscle was told to add Muscle gear the outfit had no reason to wear.
 */
import { describe, expect, it } from "vitest";

import { Game, Tools, loadGame } from "./support/harness";

// The Marinara Trench's toughest monster (docs/sea-reference.md §3): Def 630, 800 HP.
const DEF = 630;
const HP = 800;
// Guaranteed-hit threshold vs Def 630: 630 + 5 + (5 + floor(430/20)) = 661 Muscle.
const MUSCLE_FOR_HIT = 661;

function cleaverScenario(t: Tools, { cantMiss }: { cantMiss: boolean }): void {
  const cleaver = t.item("June cleaver", { count: 1 });
  const mods = t.state.itemMods.get(t.mocks.Item.get("June cleaver")) ?? {};
  mods.Power = 100;
  if (cantMiss) mods["Attacks Can't Miss"] = true;
  t.state.itemMods.set(t.mocks.Item.get("June cleaver"), mods);
  t.state.equipped.set(t.mocks.Slot.get("weapon"), t.mocks.Item.get("June cleaver"));
  void cleaver;
}

function plan(g: Game) {
  return g.combat.weaponAttackPlan(DEF, HP);
}

describe("weaponAttackPlan hit guarantee", () => {
  it("out-statting Defense guarantees the hit (wiki threshold)", async () => {
    const g = await loadGame((t) => {
      cleaverScenario(t, { cantMiss: false });
      t.state.buffedStats.Muscle = MUSCLE_FOR_HIT;
    });
    expect(plan(g).hitGuaranteed).toBe(true);
    g.state.buffedStats.Muscle = MUSCLE_FOR_HIT - 1;
    expect(plan(g).hitGuaranteed).toBe(false);
  });

  it("a weapon that cannot miss guarantees the hit regardless of Muscle", async () => {
    const g = await loadGame((t) => {
      cleaverScenario(t, { cantMiss: true });
      t.state.buffedStats.Muscle = 100;
    });
    expect(plan(g).hitGuaranteed).toBe(true);
  });

  it("a player-wide can't-miss source (effect or other gear) also guarantees the hit", async () => {
    const g = await loadGame((t) => {
      cleaverScenario(t, { cantMiss: false });
      t.state.buffedStats.Muscle = 100;
      t.state.playerMods["Attacks Can't Miss"] = true;
    });
    expect(plan(g).hitGuaranteed).toBe(true);
  });

  it("the sim's unequipped drunkweapon is judged by its own enchantment", async () => {
    const g = await loadGame((t) => {
      cleaverScenario(t, { cantMiss: true });
      t.state.buffedStats.Muscle = 100;
      // Nothing wielded: the sim passes the owned drunkweapon explicitly.
      t.state.equipped.delete(t.mocks.Slot.get("weapon"));
    });
    const cleaver = g.mocks.Item.get("June cleaver") as unknown as Parameters<
      typeof g.combat.weaponAttackPlan
    >[2];
    expect(g.combat.weaponAttackPlan(DEF, HP, cleaver).hitGuaranteed).toBe(true);
  });

  it("cannot-miss does not fake the damage: one-shot still needs the HP", async () => {
    const g = await loadGame((t) => {
      cleaverScenario(t, { cantMiss: true });
      t.state.buffedStats.Muscle = 100;
    });
    // Muscle 100 vs Def 630 → stat term 0; floor(100/10) = 10 weapon damage; no bonuses.
    const p = plan(g);
    expect(p.hitGuaranteed).toBe(true);
    expect(p.damage).toBe(10);
    expect(p.canOneShot).toBe(false);
    // Enough weapon damage to clear 800 HP makes it a one-shot without any Muscle.
    g.state.playerMods["Weapon Damage"] = 790;
    expect(plan(g).canOneShot).toBe(true);
  });
});
