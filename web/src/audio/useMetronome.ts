import { useSyncExternalStore } from "react";

import { metronome, type MetronomeState } from "./metronome.ts";

export function useMetronome(): MetronomeState {
  return useSyncExternalStore(metronome.subscribe, metronome.get);
}
