import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import { migrateSessionStorage } from "./api.ts";
import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";
import "./styles/generic.css";
import "./styles/materials.css";
import "./styles/coach.css";

migrateSessionStorage();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
