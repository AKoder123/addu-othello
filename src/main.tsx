import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OthelloGame } from "./OthelloGame";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OthelloGame />
  </StrictMode>,
);
