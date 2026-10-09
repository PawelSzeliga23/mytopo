import { useEditor } from "@/editor/store";
import type { PointKind } from "@/lib/api";

export const KINDS: PointKind[] = ["start", "ring", "hak", "ucho", "stanowisko", "ogranicznik", "przelot"];

interface Props {
  /** Phone "Odklej": the next drag moves only this line's point. */
  detach: boolean;
  onDetach(detach: boolean): void;
}

/** Kind of the selected point, its removal and (on touch) detaching it from twins in the same place. */
export function PointPanel({ detach, onDetach }: Props) {
  const draft = useEditor((s) => s.draft);
  const lineKey = useEditor((s) => s.selectedLineKey);
  const pointKey = useEditor((s) => s.selectedPointKey);
  const { setKind, deletePoint } = useEditor.getState();
  const point = draft.lines.find((line) => line.key === lineKey)?.points.find((p) => p.key === pointKey);
  if (!lineKey || !pointKey || !point) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Zaznaczony punkt</h2>
      <div role="group" aria-label="Rodzaj punktu" className="flex flex-wrap gap-1">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={point.kind === kind}
            onClick={() => setKind(lineKey, pointKey, kind)}
            className="rounded-md border border-border px-2 py-1 text-sm aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {kind}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          aria-pressed={detach}
          onClick={() => onDetach(!detach)}
          className="rounded-md border border-border px-2 py-1 text-sm aria-pressed:bg-foreground aria-pressed:text-background"
          title="Przesuwaj tylko punkt tej linii (Alt na komputerze)"
        >
          Odklej
        </button>
        <button
          type="button"
          onClick={() => deletePoint(lineKey, pointKey)}
          className="rounded-md border border-border px-2 py-1 text-sm text-destructive"
        >
          Usuń punkt
        </button>
      </div>
    </div>
  );
}
