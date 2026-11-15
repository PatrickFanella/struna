export const GUEST_KEY = "struna.guest.v1";
export type GuestState = {
  version: 1;
  focus: "notes" | "rhythm" | "chords";
  experience: "new" | "returning";
  step: "welcome" | "practice" | "reflection" | "done";
  mode: "play" | "explore";
  reflection: string;
};
export const freshGuest = (): GuestState => ({ version: 1, focus: "notes", experience: "new", step: "welcome", mode: "play", reflection: "" });
export function readGuest(raw: string | null): GuestState | null {
  if (raw === null) return freshGuest();
  try {
    const s = JSON.parse(raw);
    if (s?.version !== 1 || !["notes", "rhythm", "chords"].includes(s.focus) || !["new", "returning"].includes(s.experience) || !["welcome", "practice", "reflection", "done"].includes(s.step) || !["play", "explore"].includes(s.mode) || typeof s.reflection !== "string") return null;
    return { version: 1, focus: s.focus, experience: s.experience, step: s.step, mode: s.mode, reflection: s.reflection.slice(0, 2000) };
  } catch { return null; }
}
/** Original, short six-string guitar exercises; no owner materials or server plan. */
export function guestExercise(state: Pick<GuestState, "focus" | "experience">) {
  const returning = state.experience === "returning";
  if (state.focus === "rhythm") return {
    title: returning ? "Make space in a rhythm" : "Find four steady beats",
    instruction: returning ? "Mute the strings gently. Count 1-and-2-and-3-and-4-and. Play down on each number and up on the and after 2 and 4. Leave the other ands silent. Repeat slowly for about two minutes." : "Rest your fretting hand gently across the strings without squeezing. Count 1, 2, 3, 4 aloud and brush down once on each number. Keep each stroke small. Rest, then repeat for about two minutes.",
    music: returning ? "Count: 1 & 2 & 3 & 4 &\nStrum: ↓   ↓ ↑ ↓   ↓ ↑" : "Count: 1   2   3   4\nStrum: ↓   ↓   ↓   ↓",
  };
  if (state.focus === "chords") return {
    title: returning ? "An easy Em to Am change" : "Let an E minor chord ring",
    instruction: returning ? "Form a comfortable E minor chord, then A minor. Give each chord four slow counts. Use as little pressure as needed and pause between changes if the hand tightens. Repeat for about two minutes; smooth changes matter more than speed." : "Place two fingers at fret 2 on the A and D strings; leave the other strings open. Brush all six strings gently for E minor. Listen to one string at a time. Release your hand between attempts. Explore for about two minutes without forcing a stretch.",
    music: returning ? "Chord: Em      Am\nCount: 1 2 3 4 1 2 3 4" : "Em, from thin to thick string:\ne|--0--|\nB|--0--|\nG|--0--|\nD|--2--|\nA|--2--|\nE|--0--|",
  };
  return {
    title: returning ? "Cross three open strings" : "Give one open string room",
    instruction: returning ? "Play the open D, G, B, then G strings slowly, one note per count. Keep the picking motion small and let the hand relax between loops. Repeat for about two minutes, pausing whenever you need." : "Find the G string, third from the thinnest string. Pick it once without pressing a fret. Let the sound fade. Count four slow beats before picking again. Repeat for about two minutes with a relaxed hand.",
    music: returning ? "e|-------------|\nB|------0------|\nG|---0-----0---|\nD|0------------|\nA|-------------|\nE|-------------|" : "e|-------------|\nB|-------------|\nG|0---0---0---0|\nD|-------------|\nA|-------------|\nE|-------------|",
  };
}
