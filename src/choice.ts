import { availableChoiceOptions, print, runChoice } from "kolmafia";

// NC 1562 "Time is a Möbius Strip" (Möbius ring, fires only while worn): option
// numbers rotate between visits, so match by button text (loopstar's approach).
// Always skip — free, no turn, no Paradoxicity drift (user decision, 2026-08-12).
const MOBIUS_STRIP_CHOICE = 1562;
const SKIP_TEXT = "I'm not messing with the timeline!";

export function main(choice: number, page: string): void {
  void page;
  if (choice !== MOBIUS_STRIP_CHOICE) return;
  const options = availableChoiceOptions();
  for (const [num, text] of Object.entries(options)) {
    if (text === SKIP_TEXT) {
      runChoice(Number(num));
      return;
    }
  }
  // Leave it unhandled so mafia's abort surfaces the problem rather than
  // silently gambling with the timeline (spec: error handling).
  print(`pearlo-choice: choice 1562 has no "${SKIP_TEXT}" option — not answering it.`, "red");
}
