import type { MaterialRef } from "../generic.ts";
import { materialHash } from "../materials/route.ts";

/** Opening a resource changes only navigation; Practice remains mounted. */
export function StageMaterialLink({ material }: { material: MaterialRef }) {
  if (material.missing || !material.itemId) return <p className="srcnote">{material.label} is unavailable. <a href="#materials">Add it in Materials</a>, or ask Coach to correct the plan reference.</p>;
  return <a className="linkbtn stage-material-link" href={materialHash(material.itemId)} onClick={(e) => {
    e.preventDefault();
    history.pushState({ materialFromPractice: true }, "", materialHash(material.itemId!));
    dispatchEvent(new HashChangeEvent("hashchange"));
  }}>Open {material.label}</a>;
}
