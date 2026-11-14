import type { LibItem } from "./item.ts";

/** Replaced by the viewers in Task 4. */
export function Viewer({ item, onClose }: { item: LibItem; onClose: () => void; onPractice?: (() => void) | undefined }) {
  return (
    <div className="viewer">
      <button className="linkbtn" onClick={onClose}>Back to the library</button>
      <h1>{item.title}</h1>
    </div>
  );
}
