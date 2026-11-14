import { useCallback, useEffect, useMemo, useState } from "react";

import type { Tool } from "../App.tsx";
import { api, store } from "../api.ts";
import { metronome, SUBDIVISIONS } from "../audio/metronome.ts";
import { useMetronome } from "../audio/useMetronome.ts";
import { screenContext } from "../screen.ts";
import type { Today } from "../types.ts";
import { type PaneItem, vaultSrc } from "./Material.tsx";
import { Review } from "./Review.tsx";
import { Session, type SessionState } from "./Session.tsx";
import { Start } from "./Start.tsx";

const SESSION_KEY = "guitar-room.session";
/** Set by the library's "Use in practice"; read for the current session only. */
export const LIBRARY_MATERIAL_KEY = "guitar-room.material";

type Phase = { name: "start" } | { name: "session" } | { name: "review" } | { name: "done"; file: string };

function loadSession(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionState) : null;
  } catch {
    return null;
  }
}
function saveSession(s: SessionState | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}
function libraryItem(): PaneItem | null {
  try {
    const raw = sessionStorage.getItem(LIBRARY_MATERIAL_KEY);
    return raw ? (JSON.parse(raw) as PaneItem) : null;
  } catch {
    return null;
  }
}

export function Practice({ openTool, closeTools, openChat }: { openTool: (t: Tool) => void; closeTools: () => void; openChat: () => void }) {
  const [today, setToday] = useState<Today | null>(null);
  const [loadError, setLoadError] = useState("");
  const [session, setSessionState] = useState<SessionState | null>(loadSession);
  const [phase, setPhase] = useState<Phase>(() => (loadSession() ? { name: "session" } : { name: "start" }));
  const [extra, setExtra] = useState<PaneItem | null>(libraryItem);
  const m = useMetronome();

  const load = useCallback(() => {
    api.get<Today>("/api/today").then(
      (t) => {
        setToday(t);
        setLoadError("");
      },
      (e) => setLoadError(String(e.message ?? e)),
    );
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const on = () => setExtra(libraryItem());
    addEventListener("guitar-room:material", on);
    return () => removeEventListener("guitar-room:material", on);
  }, []);

  const setSession = useCallback((fn: (s: SessionState) => SessionState) => {
    setSessionState((s) => {
      if (!s) return s;
      const n = fn(s);
      saveSession(n);
      return n;
    });
  }, []);

  const items = useMemo<PaneItem[]>(() => {
    const block = (today?.block?.materials ?? []).map<PaneItem>((mat) => ({
      key: mat.path,
      label: mat.label,
      kind: mat.kind,
      src: mat.exists ? vaultSrc(mat.path) : null,
      ...(mat.exists ? {} : { missing: true }),
      note: mat.path.split("/").pop()!,
    }));
    return extra ? [extra, ...block] : block;
  }, [today, extra]);
  const material = items.find((i) => i.key === session?.materialKey) ?? extra ?? items.find((i) => !i.missing && i.kind === "pdf") ?? items[0] ?? null;

  useEffect(() => {
    const stage = session && today ? today.stages[session.kind][session.stage] : undefined;
    screenContext.set({
      view: phase.name === "session" ? "practice session" : phase.name === "review" ? "session review" : "practice start",
      ...(stage ? { stage: stage.title } : {}),
      ...(material && phase.name !== "start" ? { fragment: material.label } : {}),
      bpm: m.bpm,
      subdivision: SUBDIVISIONS.find((s) => s.value === m.subdivision)!.log,
    });
  }, [phase, session, today, material, m.bpm, m.subdivision]);

  const start = async (kind: "full" | "floor", cross?: string) => {
    // An item sent from the library ("Use in practice") leads this session; otherwise the block's first PDF.
    const first = extra ?? items.find((i) => !i.missing && i.kind === "pdf") ?? items[0];
    // Start from the last clean working tempo stored for this material, when there is one.
    if (first) {
      const tempos = await api.get<{ fragment: string; bpm: number }[]>("/api/tempos").catch(() => []);
      const t = tempos.find((x) => x.fragment === first.label);
      if (t) metronome.set({ bpm: t.bpm });
    }
    const s: SessionState = {
      kind,
      cross: cross ?? null,
      stage: 0,
      elapsedBefore: 0,
      resumedAt: Date.now(),
      startBpm: metronome.get().bpm,
      subdivision: metronome.get().subdivision,
      helper: { cleans: 0, misses: 0 },
      passes: 0,
      suggestion: null,
      metThree: false,
      recording: null,
      pain: false,
      materialKey: first?.key ?? null,
    };
    saveSession(s);
    setSessionState(s);
    setPhase({ name: "session" });
  };

  const end = () => {
    metronome.stop();
    saveSession(null);
    setSessionState(null);
    // "Use in practice" lasts for one session only.
    try {
      sessionStorage.removeItem(LIBRARY_MATERIAL_KEY);
    } catch {
      /* storage unavailable */
    }
    setExtra(null);
  };

  if (loadError) return <div className="notice" role="alert"><p><b>Could not load today's session.</b> {loadError}</p><button className="btn outline" onClick={load}>Try again</button></div>;
  if (!today) return <p className="srcnote">Loading today's session</p>;

  if (phase.name === "done") {
    return (
      <div className="start">
        <h1>Log written</h1>
        <p className="instr">{phase.file}</p>
        <p className="srcnote">In Practice/Logs in the vault. The app never edits it again; commit it when you review.</p>
        <button className="btn primary full push" onClick={() => {
          setPhase({ name: "start" });
          load();
        }}>Back to today</button>
      </div>
    );
  }

  if (phase.name === "start" || !session || !today.block) {
    return <Start today={today} onStart={start} onTune={() => openTool("tuner")} onCoach={openChat} onWeek={async (week) => {
      await api.put("/api/week-override", { week });
      load();
    }} />;
  }

  if (phase.name === "review") {
    return (
      <Review
        today={today}
        session={session}
        bpm={m.bpm}
        material={material?.label ?? ""}
        onBack={() => {
          setSession((s) => ({ ...s, pain: false, resumedAt: Date.now() }));
          setPhase({ name: "session" });
        }}
        onDiscard={() => {
          end();
          setPhase({ name: "start" });
        }}
        onWritten={(file) => {
          end();
          setPhase({ name: "done", file });
        }}
      />
    );
  }

  return (
    <Session
      today={today}
      state={session}
      setState={setSession}
      items={items}
      material={material}
      onPickMaterial={(key) => setSession((s) => ({ ...s, materialKey: key }))}
      onFinish={() => {
        setSession((s) => ({ ...s, elapsedBefore: s.elapsedBefore + (s.resumedAt ? Date.now() - s.resumedAt : 0), resumedAt: null }));
        setPhase({ name: "review" });
      }}
      closeTools={closeTools}
    />
  );
}
