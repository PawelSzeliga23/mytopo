import type Konva from "konva";
import { useEffect, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Text } from "react-konva";
import { isDrag } from "@/crag/gesture";
import { clampView, IDENTITY, panBy, toScreen, zoomAt, type Point, type Size, type View } from "@/crag/view";
import { Mark } from "@/crag/WallCanvas";
import { HANDLE_RADIUS, LINE_HIT, nearestSegment, toPhoto } from "@/editor/geometry";
import { draftLabels } from "@/editor/labels";
import { useEditor } from "@/editor/store";
import type { DraftLine, DraftPoint } from "@/editor/types";
import type { RouteOut } from "@/lib/api";
import { bandColor, UNGRADED_COLOR } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

export type Tool = "select" | "line" | "point" | "variant";

interface EditorCanvasProps {
  image: HTMLImageElement;
  routes: Map<number, RouteOut>;
  size: Size;
  tool: Tool;
  /** "Odklej" switched on (phone): a dragged point leaves its twins in place. */
  detach: boolean;
  /** The variant tool picked its branch point; the page switches to adding points. */
  onVariantStarted(): void;
}

type KonvaEvent = Konva.KonvaEventObject<MouseEvent | TouchEvent>;

interface Handle {
  lineKey: string;
  pointKey: string;
  screen: Point;
}

type Gesture =
  | {
      kind: "handle";
      handle: Handle;
      at: Point;
      travel: number;
      touch: boolean;
      alt: boolean;
    }
  | { kind: "pan"; last: Point }
  | { kind: "pinch"; last: Point; spread: number }
  | { kind: "tap"; start: Point; travel: number; touch: boolean };

const WHEEL_STEP = 1.2;
const LOUPE = { radius: 55, lift: 80, zoom: 2.5 } as const;

const center = (points: Point[]) => ({
  x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
  y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
});
const spread = ([a, b]: Point[]) => Math.hypot(a.x - b.x, a.y - b.y);

export function EditorCanvas({ image, routes, size, tool, detach, onVariantStarted }: EditorCanvasProps) {
  const { theme } = useTheme();
  const draft = useEditor((s) => s.draft);
  const selectedLineKey = useEditor((s) => s.selectedLineKey);
  const selectedPointKey = useEditor((s) => s.selectedPointKey);
  const [rawView, setView] = useState<View>(IDENTITY);
  const view = clampView(rawView, size);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const spaceDown = useRef(false);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement))
        spaceDown.current = true;
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const imageSize = {
    width: image.naturalWidth || 1,
    height: image.naturalHeight || 1,
  };
  const screen = (point: Point) => toScreen(point, imageSize, size, view);
  const photo = (point: Point) => toPhoto(point, imageSize, size, view);
  const labels = draftLabels(draft);

  const colorOf = (line: DraftLine) => {
    if (line.route === null || !("routeId" in line.route)) return UNGRADED_COLOR[theme];
    return bandColor(routes.get(line.route.routeId)?.grade_sort ?? null, theme);
  };

  // The point being dragged is drawn at the pointer until the drag ends (then one store action = one undo step).
  const dragged = gesture?.kind === "handle" && isDrag(gesture.travel) ? gesture : null;
  const pointAt = (line: DraftLine, point: DraftPoint): Point => {
    if (dragged && dragged.handle.lineKey === line.key && dragged.handle.pointKey === point.key) return dragged.at;
    return screen(point);
  };

  const handleLines = tool === "variant" ? draft.lines : draft.lines.filter((line) => line.key === selectedLineKey);
  const handles: Handle[] = handleLines.flatMap((line) =>
    line.points.map((point) => ({
      lineKey: line.key,
      pointKey: point.key,
      screen: screen(point),
    })),
  );

  function pointsOf(event: KonvaEvent): Point[] {
    const stage = event.target.getStage();
    if (!stage) return [];
    if ("touches" in event.evt) {
      const rect = stage.container().getBoundingClientRect();
      return Array.from(event.evt.touches).map((touch) => ({
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      }));
    }
    const pointer = stage.getPointerPosition();
    return pointer ? [pointer] : [];
  }

  function handleAt(at: Point, touch: boolean): Handle | null {
    const radius = (touch ? HANDLE_RADIUS.touch : HANDLE_RADIUS.mouse) + 3;
    let best: Handle | null = null;
    let bestDistance = Infinity;
    for (const handle of handles) {
      const distance = Math.hypot(handle.screen.x - at.x, handle.screen.y - at.y);
      if (distance <= radius && distance < bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best;
  }

  function start(event: KonvaEvent) {
    const points = pointsOf(event);
    if (points.length === 0) return;
    const touch = "touches" in event.evt;
    if (points.length > 1) {
      setGesture({
        kind: "pinch",
        last: center(points),
        spread: spread(points),
      });
      return;
    }
    const at = points[0];
    const mouse = event.evt as MouseEvent;
    if (!touch && (mouse.button === 1 || spaceDown.current)) {
      setGesture({ kind: "pan", last: at });
      return;
    }
    const handle = handleAt(at, touch);
    if (handle && tool !== "variant") {
      useEditor.getState().select(handle.lineKey, handle.pointKey);
      setGesture({
        kind: "handle",
        handle,
        at,
        travel: 0,
        touch,
        alt: !touch && mouse.altKey,
      });
      return;
    }
    setGesture({ kind: "tap", start: at, travel: 0, touch });
  }

  function move(event: KonvaEvent) {
    if (!gesture) return;
    const points = pointsOf(event);
    if (points.length === 0) return;
    event.evt.preventDefault();
    if (gesture.kind === "pinch" && points.length > 1) {
      const mid = center(points);
      const ratio = spread(points) / gesture.spread;
      setView((current) => zoomAt(panBy(current, mid.x - gesture.last.x, mid.y - gesture.last.y, size), mid, ratio, size));
      setGesture({ kind: "pinch", last: mid, spread: spread(points) });
    } else if (gesture.kind === "pan") {
      const at = points[0];
      setView((current) => panBy(current, at.x - gesture.last.x, at.y - gesture.last.y, size));
      setGesture({ kind: "pan", last: at });
    } else if (gesture.kind === "handle") {
      const at = points[0];
      setGesture({
        ...gesture,
        at,
        travel: gesture.travel + Math.hypot(at.x - gesture.at.x, at.y - gesture.at.y),
      });
    } else if (gesture.kind === "tap") {
      const at = points[0];
      const travel = Math.hypot(at.x - gesture.start.x, at.y - gesture.start.y);
      // A mouse dragging the photo pans it; one finger never pans (it edits), two fingers do.
      if (!gesture.touch && isDrag(travel)) setGesture({ kind: "pan", last: at });
      else setGesture({ ...gesture, travel });
    }
  }

  function end() {
    const current = gesture;
    setGesture(null);
    if (!current) return;
    const store = useEditor.getState();
    if (current.kind === "handle") {
      if (isDrag(current.travel))
        store.movePoint(current.handle.lineKey, current.handle.pointKey, photo(current.at), detach || current.alt);
      return;
    }
    if (current.kind !== "tap" || isDrag(current.travel)) return;
    tap(current.start, current.touch);
  }

  function tap(at: Point, touch: boolean) {
    const store = useEditor.getState();
    if (tool === "variant") {
      const handle = handleAt(at, touch);
      if (!handle) return;
      const parentLine = draft.lines.find((line) => line.key === handle.lineKey);
      store.newVariant({ lineKey: handle.lineKey, pointKey: handle.pointKey }, parentLine?.route ?? null);
      onVariantStarted();
      return;
    }
    if ((tool === "line" || tool === "point") && selectedLineKey) {
      store.appendPoint(selectedLineKey, photo(at));
      return;
    }
    // Select tool: a click on the selected line's segment inserts a point; on another line selects it.
    const selected = draft.lines.find((line) => line.key === selectedLineKey);
    if (selected) {
      const hit = nearestSegment(selected.points.map(screen), at, LINE_HIT);
      if (hit) {
        store.insertPoint(selected.key, hit.index, photo(at));
        return;
      }
    }
    let best: { key: string; distance: number } | null = null;
    for (const line of draft.lines) {
      const hit = nearestSegment(line.points.map(screen), at, LINE_HIT);
      if (hit && (!best || hit.distance < best.distance)) best = { key: line.key, distance: hit.distance };
    }
    store.select(best?.key ?? null, null);
  }

  const topLeft = screen({ x: 0, y: 0 });
  const bottomRight = screen({ x: 1, y: 1 });
  const photoRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };

  const drawLines = (emphasize: boolean) =>
    draft.lines.map((line) => {
      const selected = line.key === selectedLineKey;
      const color = colorOf(line);
      const flat = line.points.flatMap((point) => {
        const { x, y } = pointAt(line, point);
        return [x, y];
      });
      const opacity = !emphasize || selected || selectedLineKey === null ? 1 : 0.45;
      const first = line.points[0] ? pointAt(line, line.points[0]) : null;
      return (
        <Group key={line.key} opacity={opacity} listening={false}>
          <Line
            points={flat}
            stroke="rgba(0,0,0,0.45)"
            strokeWidth={(selected ? 6 : 3) + 3}
            tension={0.3}
            lineCap="round"
            lineJoin="round"
          />
          <Line points={flat} stroke={color} strokeWidth={selected ? 6 : 3} tension={0.3} lineCap="round" lineJoin="round" />
          {!selected &&
            line.points
              .filter((point) => point.kind !== "przelot")
              .map((point) => <Mark key={point.key} mark={{ ...pointAt(line, point), kind: point.kind }} color={color} />)}
          {first && (
            <Group x={first.x + (line.parent ? 16 : 0)} y={first.y + 16}>
              <Circle radius={11} fill={color} stroke="#FFFFFF" strokeWidth={1.5} />
              <Text
                text={labels.get(line.key) ?? ""}
                fontFamily="IBM Plex Sans"
                fontStyle="600"
                fontSize={11}
                fill="#FFFFFF"
                width={22}
                height={22}
                offsetX={11}
                offsetY={11}
                align="center"
                verticalAlign="middle"
              />
            </Group>
          )}
        </Group>
      );
    });

  const touchHandles = gesture?.kind === "handle" ? gesture.touch : false;
  const radius = touchHandles || window.matchMedia?.("(pointer: coarse)").matches ? HANDLE_RADIUS.touch : HANDLE_RADIUS.mouse;
  const loupe = dragged?.touch ? dragged.at : null;
  const loupeCenter = loupe ? { x: loupe.x, y: Math.max(LOUPE.radius, loupe.y - LOUPE.lift) } : null;

  const zoomButton = (factor: number) => setView((current) => zoomAt(current, { x: size.width / 2, y: size.height / 2 }, factor, size));

  return (
    <>
      <Stage
        width={size.width}
        height={size.height}
        style={{
          cursor: tool === "select" ? "default" : "crosshair",
          touchAction: "none",
        }}
        onWheel={(event) => {
          event.evt.preventDefault();
          const pointer = event.target.getStage()?.getPointerPosition();
          if (pointer) setView((current) => zoomAt(current, pointer, event.evt.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, size));
        }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={() => setGesture(null)}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
        onTouchCancel={() => setGesture(null)}
      >
        <Layer>
          <KonvaImage image={image} {...photoRect} listening={false} />
          {drawLines(true)}
          {handles.map((handle) => {
            const line = draft.lines.find((l) => l.key === handle.lineKey)!;
            const point = line.points.find((p) => p.key === handle.pointKey)!;
            const at = pointAt(line, point);
            const active = handle.pointKey === selectedPointKey && handle.lineKey === selectedLineKey;
            const hollow = point.kind === "przelot";
            return (
              <Circle
                key={`${handle.lineKey}:${handle.pointKey}`}
                x={at.x}
                y={at.y}
                radius={hollow ? radius * 0.7 : radius}
                fill={hollow ? "rgba(255,255,255,0.15)" : "#FFFFFF"}
                stroke={active ? "#C2541B" : "#2B2420"}
                strokeWidth={active ? 3 : 2}
                listening={false}
              />
            );
          })}
        </Layer>
        {loupe && loupeCenter && (
          <Layer listening={false}>
            <Group
              clipFunc={(ctx) => {
                ctx.arc(loupeCenter.x, loupeCenter.y, LOUPE.radius, 0, Math.PI * 2, false);
              }}
            >
              <Group
                x={loupeCenter.x - loupe.x * LOUPE.zoom}
                y={loupeCenter.y - loupe.y * LOUPE.zoom}
                scaleX={LOUPE.zoom}
                scaleY={LOUPE.zoom}
              >
                <KonvaImage image={image} {...photoRect} />
                {drawLines(false)}
              </Group>
            </Group>
            <Circle x={loupeCenter.x} y={loupeCenter.y} radius={LOUPE.radius} stroke="#FFFFFF" strokeWidth={3} shadowBlur={6} />
            <Line points={[loupeCenter.x - 10, loupeCenter.y, loupeCenter.x + 10, loupeCenter.y]} stroke="#C2541B" strokeWidth={2} />
            <Line points={[loupeCenter.x, loupeCenter.y - 10, loupeCenter.x, loupeCenter.y + 10]} stroke="#C2541B" strokeWidth={2} />
          </Layer>
        )}
      </Stage>
      <div className="absolute bottom-2 right-2 flex gap-1">
        {[
          {
            label: "Przybliż zdjęcie",
            text: "+",
            onClick: () => zoomButton(1.5),
          },
          {
            label: "Oddal zdjęcie",
            text: "−",
            onClick: () => zoomButton(1 / 1.5),
          },
          {
            label: "Całe zdjęcie",
            text: "⤢",
            onClick: () => setView(IDENTITY),
          },
        ].map((button) => (
          <button
            key={button.label}
            type="button"
            aria-label={button.label}
            title={button.label}
            onClick={button.onClick}
            className="size-9 rounded-md bg-background/90 text-sm font-semibold shadow-float hover:bg-background"
          >
            {button.text}
          </button>
        ))}
      </div>
    </>
  );
}
