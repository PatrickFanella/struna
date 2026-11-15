import { validBpm, type TempoRecord } from "./stageTempo.ts";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Tool } from "../App.tsx";
import { api, store } from "../api.ts";
import { metronome, SUBDIVISIONS } from "../audio/metronome.ts";
import { useMetronome } from "../audio/useMetronome.ts";
import type { Changed, Profile } from "../generic.ts";
import { refPaneItem } from "../materials/item.ts";
import { useApp } from "../mode.ts";
import { screenContext } from "../screen.ts";
import { sessionKind, type Today } from "../types.ts";
import { MAX_PANES, pane, withCompanion } from "../workspace/Workspace.tsx";
import { GenericReview } from "./GenericReview.tsx";
import { GenericStart } from "./GenericStart.tsx";
import { fromForm, REVIEW_DRAFT_KEY, toForm } from "./genericLogic.ts";
import { type PaneItem, vaultSrc } from "./Material.tsx";
import { Review } from "./Review.tsx";
import { Session, type SessionState } from "./Session.tsx";
import { Setup } from "./Setup.tsx";
import { Start } from "./Start.tsx";

const SESSION_KEY = "struna.session";
/** Set by the library's "Use in practice"; read for the current session only. */
export const LIBRARY_MATERIAL_KEY = "struna.material";

type Phase = { name: "start" } | { name: "session" } | { name: "review" } | { name: "done"; file: string };

function loadSession(): SessionState | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SessionState;
    return { ...s, panes: Array.isArray(s.panes) ? s.panes : [] };
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
  const [phase, setPhase] = useState<Phase>(() => {
    const s = loadSession();
    return s?.reviewing ? { name: "review" } : s ? { name: "session" } : { name: "start" };
  });
  const [extra, setExtra] = useState<PaneItem | null>(libraryItem);
  const [editing, setEditing] = useState(false);
  const app = useApp();
  const generic = app.mode === "studio";
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
  // Studio mode: the coach changed the plan or the profile, so today is out of date.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Changed | undefined>).detail;
      if (d?.plan || d?.profile) load();
    };
    addEventListener("struna:changed", on);
    return () => removeEventListener("struna:changed", on);
  }, [load]);
  useEffect(() => {
    const on = () => setExtra(libraryItem());
    addEventListener("struna:material", on);
    return () => removeEventListener("struna:material", on);
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
    if (generic) {
      const plan = (today?.materials ?? []).map(refPaneItem);
      return extra ? [extra, ...plan.filter((i) => i.key !== extra.key)] : plan;
    }
    const block = (today?.block?.materials ?? []).map<PaneItem>((mat) => ({
      key: mat.path,
      label: mat.label,
      kind: mat.kind,
      src: mat.exists ? vaultSrc(mat.path) : null,
      ...(mat.exists ? {} : { missing: true }),
      note: mat.path.split("/").pop()!,
    }));
    return extra ? [extra, ...block] : block;
  }, [today, extra, generic]);
  const firstFile = session?.panes.find((p) => p.content.type === "file")?.content;
  const material = firstFile?.type === "file" ? firstFile.item : null;

  useEffect(() => {
    const stages = session && today ? sessionKind(today, session.kind).stages : [];
    const stage = session ? stages[Math.min(session.stage, stages.length - 1)] : undefined;
    const setup = generic && today !== null && (today.profile === null || editing);
    screenContext.set({
      view: setup ? "practice setup" : phase.name === "session" ? "practice session" : phase.name === "review" ? "session review" : "practice start",
      ...(stage ? { stage: stage.title } : {}),
      ...(material && phase.name !== "start" ? { fragment: material.label } : {}),
      bpm: m.bpm,
      subdivision: SUBDIVISIONS.find((s) => s.value === m.subdivision)!.log,
    });
  }, [phase, session, today, material, m.bpm, m.subdivision, generic, editing]);

  // "Use in practice" during a session asks first: replace the lesson's material, or add it beside.
  const [offer, setOffer] = useState<PaneItem | null>(null);
  useEffect(() => {
    if (!extra || !session) return;
    if (store.get("struna.material-placed") === extra.key) return; // Already answered; it must stick across reloads.
    if (session.panes.some((p) => p.content.type === "file" && p.content.item.key === extra.key)) return;
    setOffer(extra);
  }, [extra, Boolean(session)]); // eslint-disable-line react-hooks/exhaustive-deps
  const answerOffer = async (how: "replace" | "beside" | "no") => {
    const item = offer;
    setOffer(null);
    if (!item) return;
    store.set("struna.material-placed", item.key);
    if (how === "no") return;
    const cs = await withCompanion({ type: "file", item });
    setSession((s) => {
      // Replacing swaps the lesson's files; the coach and any tab stay.
      const kept = how === "replace" ? s.panes.filter((p) => p.content.type !== "file") : s.panes;
      const fresh = cs.filter((c) => !kept.some((p) => p.content.type === "file" && c.type === "file" && p.content.item.key === c.item.key));
      return { ...s, addedActivities: [...(s.addedActivities ?? []).filter((a) => a.key !== item.key), { key: item.key, title: item.label }], panes: [...fresh.map(pane), ...kept].slice(0, MAX_PANES), ...(how === "replace" ? { guides: {} } : {}) };
    });
  };

  const start = async (kind: string, cross?: string) => {
    // An item sent from the library ("Use in practice") leads this session; otherwise the block's first PDF.
    // In studio mode the coach orders the plan's materials, so the first one that exists leads.
    const first = generic ? (extra ?? items.find((i) => !i.missing)) : (extra ?? items.find((i) => !i.missing && i.kind === "pdf") ?? items[0]);
    const lead = first ? await withCompanion({ type: "file", item: first }) : [];
    // On a wide screen the coach opens beside the lesson.
    const panes = [...lead.map(pane), ...(window.innerWidth >= 1180 && lead.length < 3 ? [pane({ type: "coach" })] : [])];
    if (extra) store.set("struna.material-placed", extra.key);
    if (!generic && first) {
      const records = await api.get<TempoRecord[]>("/api/tempos").catch(() => []);
      const saved = records.find((r) => r.fragment === first.label);
      if (saved && validBpm(saved.bpm)) metronome.set({ bpm: saved.bpm });
    }
    const s: SessionState = {
      kind,
      stages: sessionKind(today!, kind).stages,
      cross: cross ?? null,
      startedAt: Date.now(),
      stage: 0,
      elapsedBefore: 0,
      // The timer waits: tune, read the stage, then tap it to start.
      resumedAt: null,
      startBpm: metronome.get().bpm,
      subdivision: metronome.get().subdivision,
      helper: { cleans: 0, misses: 0 },
      passes: 0,
      suggestion: null,
      metThree: false,
      recording: null,
      pain: false,
      panes,
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
    store.set("struna.material-placed", null);
    try {
      sessionStorage.removeItem(REVIEW_DRAFT_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  if (loadError) return <div className="notice" role="alert"><p><b>Could not load today's session.</b> {loadError}</p><button className="btn outline" onClick={load}>Try again</button></div>;
  if (!today) return <p className="srcnote">Loading today's session</p>;

  if (phase.name === "done") {
    return (
      <div className="start">
        <h1>Log written</h1>
        <p className="instr">{phase.file}</p>
        <p className="srcnote">{generic ? "In the logs folder of your studio. The app never changes it again; the coach reads it to plan what comes next." : "In Practice/Logs in the vault. The app never edits it again; commit it when you review."}</p>
        <button className={`btn primary full${generic ? "" : " push"}`} onClick={() => {
          setPhase({ name: "start" });
          load();
        }}>Back to today</button>
      </div>
    );
  }

  if (generic && (today.profile === null || editing)) {
    return (
      <Setup
        profile={(today.profile ?? null) as Profile | null}
        appName={app.name}
        onSaved={() => {
          setEditing(false);
          load();
        }}
        {...(today.profile ? { onCancel: () => setEditing(false) } : {})}
      />
    );
  }

  if (generic && (phase.name === "start" || !session || !today.block)) {
    return (
      <GenericStart
        today={today}
        onStart={start}
        onTune={() => openTool("tuner")}
        onCoach={openChat}
        onEditProfile={() => setEditing(true)}
        onStarter={async () => {
          const res = await api.put<{ plan: "created" | "kept" }>("/api/profile", fromForm(toForm(today.profile ?? null)));
          if (res.plan !== "created") throw new Error("the server kept the plan file that is there.");
          load();
        }}
      />
    );
  }

  if (phase.name === "start" || !session || !today.block) {
    return <Start today={today} onStart={start} onTune={() => openTool("tuner")} onCoach={openChat} onWeek={async (week) => {
      await api.put("/api/week-override", { week });
      load();
    }} />;
  }

  if (phase.name === "review") {
    const View = generic ? GenericReview : Review;
    return (
      <View
        today={today}
        session={session}
        bpm={m.bpm}
        material={material?.label ?? ""}
        onBack={() => {
          setSession(({ reviewing: _, ...s }) => ({ ...s, pain: false, resumedAt: null }));
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
    <>
    {offer && (
      <div className="finderwrap" role="dialog" aria-modal="true" aria-label="Use in this lesson">
        <div className="scrim" onClick={() => void answerOffer("no")} />
        <div className="finder offer">
          <h2>Use “{offer.label}” in this lesson?</h2>
          <p className="srcnote">Replacing swaps the lesson's material and sheet music; the coach and any tab stay open. {generic ? "Your plan is not changed." : "The practice block in your vault is not changed."}</p>
          <div className="offeracts">
            <button className="btn primary" onClick={() => void answerOffer("replace")}>Replace the lesson material</button>
            <button className="btn outline" onClick={() => void answerOffer("beside")}>Add it beside</button>
            <button className="btn quiet" onClick={() => void answerOffer("no")}>Cancel</button>
          </div>
        </div>
      </div>
    )}
    <Session
      today={today}
      state={session}
      setState={setSession}
      items={items}
      material={material?.label ?? ""}
      onFinish={() => {
        // Studio mode remembers that the review is open, so a reload (or a discarded tab) comes back to it.
        setSession((s) => ({ ...s, elapsedBefore: s.elapsedBefore + (s.resumedAt ? Date.now() - s.resumedAt : 0), resumedAt: null, ...(generic ? { reviewing: true as const } : {}) }));
        setPhase({ name: "review" });
      }}
      closeTools={closeTools}
    />
    </>
  );
}
