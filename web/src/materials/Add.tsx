import { useRef, useState } from "react";

import { api } from "../api.ts";
import type { MaterialItem } from "../generic.ts";
import { pastedText, UPLOAD_ACCEPT, webUrl } from "./item.ts";
import { readItem } from "./upload.ts";

export type AddWay = "upload" | "link" | "text";

/** The three ways to put material in the studio: files, a web link, or pasted text. */
export function AddPanel({ way, setWay, onFiles, onAdded, onClose }: {
  way: AddWay;
  setWay: (w: AddWay) => void;
  onFiles: (files: File[]) => void;
  /** A link or a text was saved. `problem` says what did not work, when the item is kept anyway. */
  onAdded: (item: MaterialItem, problem?: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="addpanel" aria-label="Add material">
      <div className="sheethd">
        <div className="seg mini words" role="radiogroup" aria-label="How to add">
          <button role="radio" aria-checked={way === "upload"} className={way === "upload" ? "on" : ""} onClick={() => setWay("upload")}>Upload files</button>
          <button role="radio" aria-checked={way === "link"} className={way === "link" ? "on" : ""} onClick={() => setWay("link")}>Add a link</button>
          <button role="radio" aria-checked={way === "text"} className={way === "text" ? "on" : ""} onClick={() => setWay("text")}>Paste text</button>
        </div>
        <button className="sheetdone" onClick={onClose}>Close</button>
      </div>
      {way === "upload" && <UploadForm onFiles={onFiles} />}
      {way === "link" && <LinkForm onAdded={onAdded} />}
      {way === "text" && <TextForm onAdded={onAdded} />}
    </section>
  );
}

function UploadForm({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="addform">
      <p className="srcnote">Sheet music and tab as PDFs or pictures, lesson videos, backing tracks, Guitar Pro and MusicXML files, text files and EPUB books. Up to 500 MB each. You can also drop files anywhere on this screen.</p>
      <input
        ref={input}
        className="sr"
        type="file"
        multiple
        accept={UPLOAD_ACCEPT}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      <button className="btn outline full" onClick={() => input.current?.click()}>Choose files</button>
    </div>
  );
}

function LinkForm({ onAdded }: { onAdded: (item: MaterialItem, problem?: string) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = url.trim();
    const address = webUrl(raw) ?? webUrl(`https://${raw}`);
    if (!raw || !address || /\s/.test(raw)) {
      setError("That does not look like a web address. It should start with https://");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = { url: address };
      if (title.trim()) body.title = title.trim();
      if (note.trim()) body.note = note.trim();
      if (save) body.save = true;
      const { item, saveError } = readItem(await api.post<unknown>("/api/materials/link", body));
      if (!item) throw new Error("The server did not say what it saved.");
      setUrl("");
      setTitle("");
      setNote("");
      setSave(false);
      onAdded(item, saveError ? `The link is saved, but a copy could not be kept: ${saveError}` : undefined);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="addform" onSubmit={submit}>
      <label className="field">
        <span className="grp">Web address</span>
        <input className="input" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} required />
      </label>
      <label className="field">
        <span className="grp">Title (optional)</span>
        <input className="input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label className="field">
        <span className="grp">Note (optional): what it is, or which part you want</span>
        <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </label>
      <label className="tick">
        <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
        <span>Keep a copy of the file. This works for a direct link to a PDF, picture, audio or video file, not for a web page or a YouTube video.</span>
      </label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn outline full" type="submit" disabled={busy || !url.trim()}>{busy ? (save ? "Saving the copy" : "Adding") : "Add the link"}</button>
    </form>
  );
}

function TextForm({ onAdded }: { onAdded: (item: MaterialItem, problem?: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const { item } = readItem(await api.post<unknown>("/api/materials/text", { title: title.trim() || "Pasted text", text: pastedText(text) }));
      if (!item) throw new Error("The server did not say what it saved.");
      setTitle("");
      setText("");
      onAdded(item);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="addform" onSubmit={submit}>
      <label className="field">
        <span className="grp">Title</span>
        <input className="input" type="text" placeholder="Song or exercise name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </label>
      <label className="field">
        <span className="grp">Lyrics, a chord chart, text tab or notes</span>
        <textarea className="input pastebox" rows={8} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} maxLength={400000} required />
      </label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn outline full" type="submit" disabled={busy || !text.trim()}>{busy ? "Saving" : "Save the text"}</button>
    </form>
  );
}
