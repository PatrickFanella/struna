import { createElement } from "react";
import type { Components } from "react-markdown";

/** Markdown is content within a view, whose h1 belongs to the application. */
export const nestedHeadings: Components = {
  h1: ({ node: _node, ...p }) => createElement("h2", p),
  h2: ({ node: _node, ...p }) => createElement("h3", p),
  h3: ({ node: _node, ...p }) => createElement("h4", p),
  h4: ({ node: _node, ...p }) => createElement("h5", p),
  h5: ({ node: _node, ...p }) => createElement("h6", p),
};
