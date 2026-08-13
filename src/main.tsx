import React from "react";
import ReactDOM from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import App from "./App";
import "./lib/amplify";
import "./styles.css";

setWorkerUrl(mapLibreWorkerUrl);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <App />,
);
