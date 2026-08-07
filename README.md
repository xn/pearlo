# pearlo

Unblemished Pearl farming for fun and profit.

Farms the five [unblemished pearl](https://wiki.kingdomofloathing.com/Unblemished_pearl)
zones in The Sea (one pearl per zone per day), handling water breathing, elemental
resistance (capped at the 18-res / 10%-progress sweet spot), buffs, HP/MP upkeep, and
combat — including farming while falling-down drunk with Drunkula's wineglass.

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
pearlo prep                  do all preparation, print a state report, spend no turns
pearlo                       farm all five pearls (spooky,sleaze,hot,stench,cold order)
pearlo pearls=cold,sleaze    farm an ordered subset
```

Useful options:

- `pearls=...` — ordered, no-duplicate subset of `spooky,sleaze,hot,stench,cold`
- `requirecap` — halt instead of farming below the 18-resistance progress cap
- `drunkweapon="June cleaver"` — weapon to wield while farming overdrunk (default shown)
- `halt=N` — stop when N or fewer adventures remain

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
