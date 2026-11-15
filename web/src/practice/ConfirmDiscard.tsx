import { useEffect, useRef } from "react";

/** Native modal supplies focus containment and makes the underlying page inert. */
export function SessionDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog className="session-dialog" ref={ref} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}>
    <h2>{title}</h2>{children}
  </dialog>;
}
export function ConfirmDiscard({ onCancel, onDiscard }: { onCancel: () => void; onDiscard: () => void }) {
  return <SessionDialog title="Discard this unsaved session?" onClose={onCancel}>
    <p>No log will be written. This session and its review draft will be cleared. Already saved recordings stay in Recordings.</p>
    <div className="row2"><button type="button" className="btn outline" autoFocus onClick={onCancel}>Keep session</button><button type="button" className="btn quiet danger" onClick={onDiscard}>Yes, discard session</button></div>
  </SessionDialog>;
}
