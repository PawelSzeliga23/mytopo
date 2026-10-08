/** Pointer travel (px) after which a gesture counts as a drag, not a click. */
export const DRAG_THRESHOLD = 4;

/**
 * Whether the gesture counts as a drag once a pointer goes down (or one of several lifts).
 * A touch joining or leaving a running gesture continues it, and two fingers are never a tap —
 * otherwise the tap Konva fires after the last pinch finger lifts would toggle a route.
 */
export function draggedAfterStart(dragged: boolean, continuing: boolean, pointCount: number): boolean {
  return (continuing && dragged) || pointCount > 1;
}

export function isDrag(travel: number): boolean {
  return travel > DRAG_THRESHOLD;
}
