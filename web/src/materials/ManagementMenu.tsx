import { useEffect, useRef, useState } from "react";

export function ManagementMenu({ name, busy, onCopy, onDelete }: { name: string; busy: boolean; onCopy?: (() => void) | undefined; onDelete?: (() => void) | undefined }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  if (!onCopy && !onDelete) return null;
  return <span className="material-management" ref={box}>
    <button type="button" className="linkbtn" ref={trigger} aria-haspopup="menu" aria-expanded={open} aria-label={`Manage ${name}`} onClick={() => setOpen(!open)}>Manage</button>
    {open && <span role="menu" aria-label={`Manage ${name}`} className="material-menu" onKeyDown={(e) => {
      if (e.key === "Escape" || e.key === "Tab") { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); } close(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (i + (e.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    }}>
      {onCopy && <button type="button" role="menuitem" disabled={busy} onClick={() => { close(); onCopy(); }}>Save a copy</button>}
      {onDelete && <button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => { close(); onDelete(); }}>Delete</button>}
    </span>}
  </span>;
}
