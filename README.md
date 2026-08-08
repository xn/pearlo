# pearlo

Unblemished Pearl farming for fun and profit.

Farms the five [unblemished pearl](https://wiki.kingdomofloathing.com/Unblemished_pearl)
zones in The Sea (one pearl per zone per day), handling water breathing, elemental
resistance (capped at the 18-res / 10%-progress sweet spot), buffs, HP/MP upkeep, and
combat — including farming while falling-down drunk with Drunkula's wineglass.

Every zone is priced before a turn is spent: pearl value (mall) minus turn cost (your
`valueOfAdventure`), restores, and debuff cures. Unprofitable zones are skipped, and
the most profitable liver configuration (organ extenders vs Stooper vs wineglass) is
chosen automatically when you're past your organ baselines.

# Installation

In the KoLmafia gCLI:

```
git checkout xn/pearlo release
```

Updates arrive automatically via mafia's built-in `git update` (or run it manually).

# Usage

```
pearlo help                  full argument reference
pearlo sim                   capability report per zone — spends nothing
pearlo sim drunk             the same report for overdrunk (wineglass) farming
pearlo profit                per-zone profit report (costs, GO/SKIP verdicts) — spends nothing
pearlo prep                  do all preparation, print a state report, spend no turns
pearlo                       farm all five pearls (spooky,sleaze,hot,stench,cold order)
pearlo pearls=cold,sleaze    farm an ordered subset
```

Useful options:

- `pearls=...` — ordered, no-duplicate subset of `spooky,sleaze,hot,stench,cold`
- `requirecap` — halt instead of farming below the 18-resistance progress cap
- `drunkweapon="June cleaver"` — weapon to wield while farming overdrunk (default shown)
- `voa=N` — meat value of an adventure for all profit decisions (default: your
  `valueOfAdventure` mafia preference)
- `force` — farm zones even when the profit model expects them to lose meat
- `overcapped` — force-equip **all** owned organ extenders (angelbone/devilbone gear)
  while running turns, keeping the extended stomach/liver/spleen caps available for
  mid-day consumption
- `halt=N` — stop when N or fewer adventures remain

## Overcapped organs

The 2026 angelbone/devilbone Standard rewards add +1 organ capacity while equipped.
pearlo detects when you're past a no-gear baseline and auto-equips the minimal set
needed to keep adventuring legal (stomach/spleen overcap otherwise blocks adventuring
entirely). Mildly overdrunk characters are rescued back under the limit with liver
extenders or the Stooper familiar when that prices better than wineglass farming; the
`profit` report shows which configuration won and why. An overcap that owned extenders
can't fix halts with an explanation — organ cleaners or rollover are the only ways out.

## Per-zone overrides

Pin a familiar and/or a saved KoL custom outfit per zone (mafia preferences, so they
persist — the arg names double as `pearlo_<name>` prefs):

```
pearlo coldfamiliar="Exotic Parrot" coldoutfit="cold pearls"
```

One `<element>familiar` / `<element>outfit` pair exists per zone
(`spooky/sleaze/hot/stench/cold`). An overridden outfit is worn as saved — the
maximizer only patches breathing into slots it leaves free — while the safety nets
(organ extenders, wineglass, avoided items like the Mer-kin digpick, `requirecap`)
still apply and win their slots. Override familiars get breathing gear automatically;
the Stooper pin takes precedence over a familiar override when it's serving as your
liver rescue. The profit model prices overridden zones as they will actually run.

The script requires Sea access, a way to breathe underwater, and (for a sober run) a
spell-based kill — it is tuned for Saucegeyser. Overdrunk farming requires Drunkula's
wineglass **in inventory** and a weapon that can one-shot the zone's toughest monster;
the script verifies this and halts rather than losing fights.

# Development

Clone the repo, then:

```bash
yarn install
yarn run build          # compile TypeScript → dist/scripts/pearlo
yarn run install-mafia  # symlink the build into KoLmafia's scripts directory (once)
yarn run watch          # rebuild on change; the symlink serves updates instantly
```

Run `pearlo` in the KoLmafia gCLI to test. `yarn lint` / `yarn format` before
committing. Reference documentation for the game mechanics this script relies on lives
in `docs/` (sea zones and monsters, organ/overdrunk rules, maximizer syntax).
