import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// Vite pre-bundling/bundling breaks MapLibre's import.meta.url-relative worker lookup, so point it at the emitted asset.
setWorkerUrl(workerUrl);
