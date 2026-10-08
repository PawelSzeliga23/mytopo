import { useRef, type CSSProperties, type ReactNode } from "react";
import { WallCanvas } from "@/crag/WallCanvas";
import type { RouteOut, WallOut } from "@/lib/api";
import { useElementSize } from "@/lib/useElementSize";
import { useHtmlImage } from "@/lib/useHtmlImage";

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

function Message({ children }: { children: ReactNode }) {
  return <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">{children}</p>;
}

/** The photo of one wall with its routes; a failed or missing photo shows a message and leaves the rest of the page working. */
export function WallViewer({ wall, className = "", style, ...canvas }: WallViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(containerRef);
  const { image, status } = useHtmlImage(wall.image_url);
  return (
    // pan-y keeps vertical page scrolling at zoom 1 on phones while two-finger gestures reach the canvas.
    <div ref={containerRef} className={`relative overflow-hidden bg-map-bg ${className}`} style={{ touchAction: "pan-y", ...style }}>
      {!wall.image_url ? (
        <Message>Brak zdjęcia tej ściany.</Message>
      ) : status === "failed" ? (
        <Message>Nie udało się wczytać zdjęcia.</Message>
      ) : status === "loading" || !image ? (
        <Message>Wczytywanie zdjęcia…</Message>
      ) : (
        size.width > 0 && size.height > 0 && <WallCanvas image={image} wall={wall} size={size} {...canvas} />
      )}
    </div>
  );
}
