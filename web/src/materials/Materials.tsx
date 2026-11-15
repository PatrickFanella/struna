import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api.ts";
import { coachAction } from "../chat/actions.tsx";
import { askCoach } from "../chat/Chat.tsx";
import type { Changed, MaterialItem, MaterialKind, Prompt } from "../generic.ts";
import { megabytes } from "../library/item.ts";
import { useApp } from "../mode.ts";
import { LIBRARY_MATERIAL_KEY } from "../practice/Practice.tsx";
import { screenContext } from "../screen.ts";
import { FileBody } from "../workspace/Workspace.tsx";
import { AddPanel, type AddWay } from "./Add.tsx";
import { externalLabel, materialName, materialProvider, fillInput, FILTER_KINDS, hostOf, KIND_LABEL, materialPaneItem, nameList, uploadProblem, webUrl } from "./item.ts";
import { readItem, uploadFile } from "./upload.ts";

export { materialPane } from "./item.ts";

/** A link whose copy could not be saved says why; one being downloaded says so. */
type Listed = MaterialItem & { saveError?: string; saving?: true };
type Result = { items: Listed[]; total?: number; truncated?: boolean; linksError?: string };
type Upload = { id: number; name: string; state: "waiting" | "sending" | "done" | "failed"; fraction: number; error?: string };

const FIND_FALLBACK = "Find materials online for this: {input}. Search the web, open what you find, and add the best three to five to my materials, each with a real title and a one-line note on who it suits. Then tell me what you added and which one to start with.";

/** The built-in prompt for finding lessons, when the server has one that only needs the player's words. */
async function findPrompt(input: string): Promise<string> {
  const r = await api.get<{ prompts?: Prompt[] }>("/api/prompts").catch(() => ({ prompts: [] as Prompt[] }));
  const finds = (r.prompts ?? []).filter((p) => p.group === "find" && !p.custom && p.text.trimEnd().endsWith("{input}"));
  const best = finds.find((p) => p.screens.includes("materials")) ?? finds[0];
  return (best && fillInput(best.text, input)) ?? fillInput(FIND_FALLBACK, input)!;
}

function facts(i: MaterialItem): string {
  const where = materialProvider(i);
  return [where, i.level ?? "", i.url && i.src ? `saved from ${hostOf(i.url)}` : ""].filter(Boolean).join(", ");
}

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
/** Links and pasted text added one after another are told to the coach together, after this quiet time. */
const ADDED_QUIET_MS = 45_000;

/** The player's own materials: uploads, web links, pasted text, the coach's lesson sheets and any library folders. */
export function Materials({ active }: { active: boolean }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<MaterialKind | null>(null);
  const [filters, setFilters] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [opened, setOpened] = useState<MaterialItem | null>(null);
  const [add, setAdd] = useState<AddWay | null>(null);
  const [finding, setFinding] = useState(false);
  const [want, setWant] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const seq = useRef(0);
  const dragDepth = useRef(0);
  const uploadId = useRef(0);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const load = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (kind) p.set("kind", kind);
    try {
      const r = await api.get<Result>(`/api/materials${p.size ? `?${p}` : ""}`);
      if (n !== seq.current) return;
      setData({ ...r, items: Array.isArray(r?.items) ? r.items : [] });
      setError("");
    } catch (e) {
      if (n === seq.current) setError(String((e as Error).message ?? e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [q, kind]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [active, load, q]);

  // The coach added, saved or rewrote something, or changed which items the plan names.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Changed | undefined>).detail;
      if (d?.materials || d?.plan) void load();
    };
    addEventListener("struna:changed", on);
    return () => removeEventListener("struna:changed", on);
  }, [load]);

  // The open item follows the list, so a saved copy or a new title shows without reopening it.
  useEffect(() => {
    if (!openId) return setOpened(null);
    const fresh = data?.items.find((i) => i.id === openId);
    if (fresh) setOpened(fresh);
  }, [openId, data]);

  // The coach's context: which screen, and the item that is open.
  useEffect(() => {
    if (!active) return;
    const before = screenContext.get();
    const mine = { view: "materials", ...(opened ? { fragment: materialName(opened) } : {}) };
    screenContext.set(mine);
    return () => {
      if (screenContext.get() === mine) screenContext.set(before);
    };
  }, [active, opened]);

  // What was added and not yet told to the coach. Uploads are told at once, as one batch; links and
  // pasted text wait until the Add panel closes or nothing new arrives for a while, so five links in a
  // row make one coach turn, not five.
  const pendingNames = useRef<string[]>([]);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushAdded = useCallback(() => {
    clearTimeout(addedTimer.current);
    const names = pendingNames.current.splice(0);
    if (names.length) void coachAction("material-added", { names: nameList(names) }).catch(() => {});
  }, []);
  const added = (items: MaterialItem[], now = true) => {
    void load();
    pendingNames.current.push(...items.map((i) => i.title));
    clearTimeout(addedTimer.current);
    if (now) flushAdded();
    else addedTimer.current = setTimeout(flushAdded, ADDED_QUIET_MS);
  };
  useEffect(() => {
    if (!add || !active) flushAdded();
  }, [add, active, flushAdded]);
  useEffect(() => flushAdded, [flushAdded]);

  /** Upload a batch one file at a time, then tell the coach once about everything that arrived. */
  const sendFiles = (files: File[]) => {
    if (!files.length) return;
    const batch = files.map((file) => ({ file, id: ++uploadId.current, problem: uploadProblem(file) }));
    setUploads((u) => [
      ...u.filter((x) => x.state !== "done"),
      ...batch.map((b): Upload => (b.problem ? { id: b.id, name: b.file.name, state: "failed", fraction: 0, error: b.problem } : { id: b.id, name: b.file.name, state: "waiting", fraction: 0 })),
    ]);
    const patch = (id: number, change: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...change } : x)));
    queue.current = queue.current.then(async () => {
      const done: MaterialItem[] = [];
      for (const b of batch) {
        if (b.problem) continue;
        patch(b.id, { state: "sending" });
        try {
          const item = await uploadFile(b.file, (fraction) => patch(b.id, { fraction }));
          done.push(item);
          patch(b.id, { state: "done", fraction: 1, name: item.title || b.file.name });
        } catch (e) {
          patch(b.id, { state: "failed", error: String((e as Error).message ?? e) });
        }
      }
      added(done);
    });
  };

  const practice = (i: MaterialItem) => {
    try {
      sessionStorage.setItem(LIBRARY_MATERIAL_KEY, JSON.stringify(materialPaneItem(i)));
    } catch {
      /* storage unavailable */
    }
    dispatchEvent(new Event("struna:material"));
    location.hash = "#practice";
  };

  const remove = async (i: MaterialItem) => {
    setBusy(i.id);
    setNotice("");
    try {
      await api.del(`/api/materials/${encodeURIComponent(i.id)}`);
      setConfirm(null);
      if (openId === i.id) setOpenId(null);
      await load();
    } catch (e) {
      setNotice(`"${i.title}" was not deleted: ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(null);
    }
  };

  const saveCopy = async (i: MaterialItem) => {
    setBusy(i.id);
    setNotice("");
    try {
      const { item, saveError } = readItem(await api.post<unknown>(`/api/materials/${encodeURIComponent(i.id)}/save`));
      if (saveError) setNotice(`A copy of "${i.title}" could not be kept: ${saveError}`);
      else if (item && openId === i.id) setOpenId(item.id);
      await load();
    } catch (e) {
      setNotice(`A copy of "${i.title}" could not be kept: ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(null);
    }
  };

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = want.trim();
    if (!input) return;
    void askCoach(await findPrompt(input), { open: true });
    setWant("");
    setFinding(false);
  };

  const canDelete = (i: MaterialItem) => i.source !== "folder";
  const canSave = (i: MaterialItem) => !i.src && Boolean(webUrl(i.url)) && !i.youtube;
  const sending = uploads.some((u) => u.state === "waiting" || u.state === "sending");

  // The copy says "drop files anywhere on this screen": while the list shows, the whole window takes them.
  const send = useRef(sendFiles);
  send.current = sendFiles;
  const listing = active && !opened;
  useEffect(() => {
    if (!listing) return;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDrag(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDrag(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.('input[type="file"]')) return; // The file input handles its own drop.
      e.preventDefault();
      dragDepth.current = 0;
      setDrag(false);
      send.current([...(e.dataTransfer?.files ?? [])]);
    };
    // On the document, so these run before the app's window-level guard against stray drops.
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
      dragDepth.current = 0;
      setDrag(false);
    };
  }, [listing]);

  const deleteAsk = (i: MaterialItem) =>
    confirm === i.id ? (
      <span className="confirm" role="group" aria-label={`Delete ${i.title}?`}>
        <span>{i.source === "link" ? "Remove this link?" : "Delete this file?"}</span>
        <button className="linkbtn" disabled={busy === i.id} onClick={() => void remove(i)}>{busy === i.id ? "Deleting" : "Yes, delete"}</button>
        <button className="linkbtn" onClick={() => setConfirm(null)}>Keep it</button>
      </span>
    ) : (
      <button className="linkbtn" onClick={() => setConfirm(i.id)}>Delete</button>
    );

  if (opened) {
    const pane = materialPaneItem(opened);
    const url = webUrl(opened.url);
    return (
      <div className="viewer matviewer">
        <button className="linkbtn" onClick={() => (setOpenId(null), setConfirm(null))}>Back to materials</button>
        <h1>{materialName(opened)}</h1>
        {materialName(opened) !== opened.title && <p className="srcnote">{opened.title}</p>}
        <p className="srcnote">
          {[KIND_LABEL[opened.kind], facts(opened), opened.size ? megabytes(opened.size) : "", opened.inPlan ? "in your plan" : ""].filter(Boolean).join(", ")}
          {opened.note ? `. ${opened.note}` : ""}
        </p>
        {notice && <p className="notice" role="alert">{notice}</p>}
        <div className="vacts">
          <button className="btn outline" onClick={() => practice(opened)}>Use in practice</button>
          {canSave(opened) && <button className="linkbtn" disabled={busy === opened.id} onClick={() => void saveCopy(opened)}>{busy === opened.id ? "Saving a copy" : "Save a copy"}</button>}
          {url && opened.src && <a className="linkbtn" href={url} target="_blank" rel="noreferrer noopener">{externalLabel(url, opened.provider)}</a>}
          {opened.src && <a className="linkbtn" href={opened.src} download={opened.path?.split(/[/:]/).pop() ?? opened.title}>Download</a>}
          {canDelete(opened) && deleteAsk(opened)}
        </div>
        <div className="vbody matbody">
          <FileBody key={pane.key} item={pane} />
        </div>
      </div>
    );
  }

  const items = data?.items ?? [];
  const filtered = Boolean(q.trim() || kind);
  const total = data?.total ?? items.length;
  return (
    <div className={`library materials${drag ? " dragging" : ""}`}>
      <div className="mathd">
        <h1>Materials</h1>
        <div className="mathdacts">
          {app.web && <button className="btn quiet" aria-expanded={finding} onClick={() => (setFinding(!finding), setAdd(null))}>Find online</button>}
          <button className="btn outline" aria-expanded={add !== null} onClick={() => (setAdd(add ? null : "upload"), setFinding(false))}>Add</button>
        </div>
      </div>
      {drag && <p className="dropnote" aria-hidden="true">Drop the files to add them to your materials.</p>}

      {finding && (
        <form className="addpanel findform" onSubmit={find} aria-label="Find materials online">
          <label className="field">
            <span className="grp">What do you want to learn or play?</span>
            <input className="input" type="text" autoFocus placeholder="A song, a style, a technique" value={want} onChange={(e) => setWant(e.target.value)} maxLength={300} />
          </label>
          <p className="srcnote">The coach searches the web, checks what it finds, and adds the best few here with a note on who each suits.</p>
          <div className="row2">
            <button className="btn quiet" type="button" onClick={() => setFinding(false)}>Cancel</button>
            <button className="btn outline" type="submit" disabled={!want.trim()}>Ask the coach</button>
          </div>
        </form>
      )}

      {add && (
        <AddPanel
          way={add}
          setWay={setAdd}
          onFiles={sendFiles}
          onClose={() => setAdd(null)}
          onAdded={(item, problem) => {
            setNotice(problem ?? "");
            added([item], false);
          }}
        />
      )}

      {uploads.length > 0 && (
        <section className="uploads" aria-label="Uploads">
          <ul aria-live="polite">
            {uploads.map((u) => (
              <li key={u.id} className={`upload ${u.state}`}>
                <span className="upname">{u.name}</span>
                {u.state === "sending" ? (
                  <progress value={u.fraction} max={1} aria-label={`Uploading ${u.name}`} />
                ) : (
                  <span className="upstate">{u.state === "waiting" ? "Waiting" : u.state === "done" ? "Added" : `Not added. ${u.error ?? ""}`}</span>
                )}
                {u.state === "sending" && <span className="upstate num">{Math.round(u.fraction * 100)}%</span>}
              </li>
            ))}
          </ul>
          {!sending && <button className="linkbtn" onClick={() => setUploads([])}>Clear this list</button>}
        </section>
      )}

      {notice && <p className="notice" role="alert">{notice}</p>}
      {data?.linksError && <p className="notice" role="alert"><b>The link list cannot be read.</b> {data.linksError} Ask the coach to fix <code>materials/links.json</code>.</p>}
      {error && <p className="notice" role="alert">{error}</p>}

      {(items.length > 0 || filtered) && (
        <>
          <div className="searchrow">
            <input className="input" type="search" placeholder="Search your materials" aria-label="Search your materials" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn quiet filterbtn" aria-expanded={filters} onClick={() => setFilters(!filters)}>Kind{kind ? <span className="num"> 1</span> : null}</button>
          </div>
          {filters && (
            <div className="filters">
              <div className="chips" role="radiogroup" aria-label="Kind">
                <button role="radio" aria-checked={!kind} className={!kind ? "on" : ""} onClick={() => setKind(null)}>All</button>
                {FILTER_KINDS.map((k) => <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
              </div>
            </div>
          )}
          <div className="libstatus">
            <span>
              <span className="num">{total}</span> {total === 1 ? "item" : "items"}
              {data?.truncated ? ". The library folders hold more files than the app lists; search to narrow them" : ""}
            </span>
          </div>
        </>
      )}

      {!data && loading && <p className="srcnote">Loading your materials</p>}
      {data && items.length === 0 && !loading && filtered && (
        <div className="empty">
          <p className="instr">Nothing matches.</p>
          <button className="btn outline" onClick={() => (setQ(""), setKind(null))}>Show everything</button>
        </div>
      )}
      {data && items.length === 0 && !filtered && !error && (
        <div className="empty matempty">
          <p className="instr">Nothing here yet. This is where your sheet music, tabs, lesson videos, backing tracks and links live, so the coach can build them into your plan and you can open them while you practice.</p>
          <ol className="ways">
            <li><b>Add your own.</b> Upload files, save a web link, or paste lyrics, a chord chart or text tab.</li>
            {app.web && <li><b>Have the coach find some.</b> Say what you want to learn or play, and the coach searches the web and adds what suits your level.</li>}
            <li><b>Ask the coach to write one.</b> In the coach panel, ask for an exercise or a lesson sheet. It is saved here.</li>
          </ol>
          <div className="startacts">
            <button className="btn primary" onClick={() => (setAdd("upload"), setFinding(false))}>Add material</button>
            {app.web && <button className="btn outline" onClick={() => (setFinding(true), setAdd(null))}>Find materials online</button>}
          </div>
        </div>
      )}

      <ul className="items">
        {items.map((i) => (
          <li key={i.id} className="item matitem">
            <button className="itemopen" onClick={() => (setNotice(""), setOpenId(i.id), setOpened(i))}>
              <span className={`thumb kind-${i.kind}`} aria-hidden="true">{KIND_LABEL[i.kind]}</span>
              <span className="itemtext">
                <span className="itemtitle">{materialName(i)}</span>
                {materialName(i) !== i.title && <span className="itemnote">{i.title}</span>}
                <span className="itemfacts">
                  <span>{facts(i)}</span>
                  {i.inPlan && <span className="inplan">In your plan</span>}
                  {i.size ? <span className="num">{megabytes(i.size)}</span> : null}
                </span>
                {i.note && <span className="itemnote">{i.note}</span>}
                {i.saveError && !i.src && <span className="itemnote">A copy was not kept: {i.saveError}</span>}
                {i.saving && !i.src && <span className="itemnote">Saving a copy…</span>}
              </span>
            </button>
            <span className="matacts">
              <button className="linkbtn" onClick={() => practice(i)}>Use in practice</button>
              {canSave(i) && <button className="linkbtn" disabled={busy === i.id} onClick={() => void saveCopy(i)}>{busy === i.id ? "Saving a copy" : "Save a copy"}</button>}
              {canDelete(i) && deleteAsk(i)}
            </span>
          </li>
        ))}
      </ul>
      {data && total > items.length && <p className="srcnote">Showing the first {items.length}. Search to find the rest.</p>}
    </div>
  );
}
