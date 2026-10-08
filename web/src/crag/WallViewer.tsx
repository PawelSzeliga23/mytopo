import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Look } from "@/crag/Wall3D";
import { WallCanvas } from "@/crag/WallCanvas";
import type { RouteOut, WallOut } from "@/lib/api";
import { useElementSize } from "@/lib/useElementSize";
import { useHtmlImage } from "@/lib/useHtmlImage";
import { hasWebGL } from "@/lib/webgl";

// three.js is large: it loads only when a 2.5D model is actually shown.
const Wall3D = lazy(() => import("@/crag/Wall3D"));

export interface WallViewerProps {
  wall: WallOut;
  routes: Map<number, RouteOut>;
  selectedRouteId: number | null;
  hoveredRouteId: number | null;
  onSelectRoute: (routeId: number | null) => void;
  onHoverRoute: (routeId: number | null) => void;
  className?: string;
  style?: CSSProperties;
}

type Mode = "3d" | "2d";

const FAIL_MESSAGE_MS = 4000;

function Message({ children }: { children: ReactNode }) {
  return <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; text: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-background/90 p-0.5 text-xs font-semibold shadow-float">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 py-1 ${value === option.value ? "bg-foreground text-background" : "hover:bg-secondary"}`}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

/**
 * One wall with its routes: the photo by default, the 2.5D model on request (ready depth map, rock not overgrown,
 * WebGL available).
 * A failed photo or model shows a message and leaves the rest of the page working.
 */
export function WallViewer({ wall, className = "", style, ...canvas }: WallViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  // show_3d is false for walls with vegetation over more than 10% of the rock (unless switched on by hand): no 2.5D there.
  const can3d = Boolean(wall.depth_url) && wall.show_3d && hasWebGL();
  // Every wall opens the same way, as the photo; the 2.5D model is one click away in the corner.
  const [mode, setMode] = useState<Mode>("2d");
  const [look, setLook] = useState<Look>("holo");
  const [relief, setRelief] = useState(0.25);
  const [failed, setFailed] = useState(false);
  const { image, status } = useHtmlImage(mode === "2d" ? wall.image_url : null);

  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), FAIL_MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  const fallBackTo2d = () => {
    setMode("2d");
    setFailed(true);
  };

  return (
    // pan-y keeps vertical page scrolling at zoom 1 on phones while two-finger gestures reach the canvas.
    <div ref={containerRef} className={`relative overflow-hidden bg-map-bg ${className}`} style={{ touchAction: "pan-y", ...style }}>
      {mode === "3d" ? (
        <Suspense fallback={<Message>Wczytywanie modelu 2.5D…</Message>}>
          <Wall3D wall={wall} look={look} relief={relief} onFail={fallBackTo2d} {...canvas} />
        </Suspense>
      ) : !wall.image_url ? (
        <Message>Brak zdjęcia tej ściany.</Message>
      ) : status === "failed" ? (
        <Message>Nie udało się wczytać zdjęcia.</Message>
      ) : status === "loading" || !image ? (
        <Message>Wczytywanie zdjęcia…</Message>
      ) : (
        size.width > 0 && size.height > 0 && <WallCanvas image={image} wall={wall} size={size} {...canvas} />
      )}
      {can3d && (
        <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1.5">
          <Segmented label="Widok ściany" value={mode} onChange={setMode} options={[{ value: "2d", text: "2D" }, { value: "3d", text: "2.5D" }]} />
          {mode === "3d" && (
            <>
              <Segmented label="Wygląd modelu" value={look} onChange={setLook} options={[{ value: "holo", text: "hologram" }, { value: "photo", text: "zdjęcie" }]} />
              <label className="flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs font-semibold shadow-float">
                głębia
                <input type="range" min={0} max={0.6} step={0.01} value={relief} onChange={(event) => setRelief(Number(event.target.value))} className="w-20" />
              </label>
            </>
          )}
        </div>
      )}
      {failed && (
        <p role="status" className="absolute inset-x-2 bottom-2 z-10 rounded-md bg-background/90 px-3 py-2 text-center text-xs shadow-float">
          Nie udało się wczytać modelu 2.5D — pokazuję zdjęcie.
        </p>
      )}
    </div>
  );
}
