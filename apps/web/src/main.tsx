import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Notifications } from "./components/Notifications";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Notifications><App /></Notifications>
  </StrictMode>
);
