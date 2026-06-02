import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { AuthProvider } from "./state";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><AuthProvider><App /><Analytics /><SpeedInsights /></AuthProvider></BrowserRouter></StrictMode>
);
