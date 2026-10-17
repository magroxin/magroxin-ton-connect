
import React from "react";
import { createRoot } from "react-dom/client";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import App from "./App";
import "./styles.css";

const MANIFEST_URL =
  "https://magroxin-ton-api.onrender.com/tonconnect-manifest.json";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>
);
