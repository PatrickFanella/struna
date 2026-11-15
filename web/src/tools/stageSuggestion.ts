import { useSyncExternalStore } from "react";
export type StageSuggestion = { bpm: number; source: string; use: () => void };
let current: StageSuggestion | null = null;
const listeners = new Set<() => void>();
export const setStageSuggestion = (value: StageSuggestion | null) => { current = value; listeners.forEach((fn) => fn()); };
export const useStageSuggestion = () => useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => current);
