import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");

if (!root) throw new Error("Command OS V2 root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
