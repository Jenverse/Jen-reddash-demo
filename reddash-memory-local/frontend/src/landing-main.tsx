import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import LandingPage from "./LandingPage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LandingPage onOpenDemo={() => window.location.assign("/")} />
  </React.StrictMode>
);
