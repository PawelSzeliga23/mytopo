import { useState } from "react";
import { ConfirmDialog } from "@/crag/edit/ConfirmDialog";
import { draftLabels } from "@/editor/labels";
import { useEditor } from "@/editor/store";
import type { DraftLine } from "@/editor/types";
import type { RouteOut } from "@/lib/api";
import { bandColor, UNGRADED_COLOR } from "@/lib/grades";
import { useTheme } from "@/lib/theme";

interface Props {
  routes: Map<number, RouteOut>;
  onNewLine(): void;
  onChangeRoute(lineKey: string): void;
}

/** Lines of the photo in topo order: choose, reorder, change route, delete. */
export function LinesPanel({ routes, onNewLine, onChangeRoute }: Props) {
  const { theme } = useTheme();
  const draft = useEditor((s) => s.draft);
  const selectedLineKey = useEditor((s) => s.selectedLineKey);
  const { select, moveLine, deleteLine } = useEditor.getState();
  const [confirm, setConfirm] = useState<DraftLine | null>(null);
  const labels = draftLabels(draft);

  const nameOf = (line: DraftLine) => {
    if (line.route === null) return "Linia bez drogi";
    if ("routeId" in line.route) return routes.get(line.route.routeId)?.name ?? "Droga";
    const key = line.route.routeKey;
    return draft.newRoutes.find((route) => route.key === key)?.name ?? "Nowa droga";
  };
  const colorOf = (line: DraftLine) =>
    line.route && "routeId" in line.route ? bandColor(routes.get(line.route.routeId)?.grade_sort ?? null, theme) : UNGRADED_COLOR[theme];

  const remove = (line: DraftLine) => {
    if (draft.lines.some((other) => other.parent?.lineKey === line.key)) setConfirm(line);
    else deleteLine(line.key);
  };

  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linie na zdjęciu</h2>
      <ul className="flex flex-col">
        {draft.lines.map((line, index) => (
          <li
            key={line.key}
            className="flex items-center gap-1 border-t border-border py-1 aria-selected:bg-secondary"
            aria-selected={line.key === selectedLineKey}
          >
            <button type="button" onClick={() => select(line.key, null)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span
                className="grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
                style={{ background: colorOf(line) }}
              >
                {labels.get(line.key)}
              </span>
              <span className="truncate font-display">{nameOf(line)}</span>
              {line.points.length < 2 && <span className="text-xs text-destructive">za mało punktów</span>}
            </button>
            <button
              type="button"
              aria-label={`Wyżej: ${nameOf(line)}`}
              disabled={index === 0}
              onClick={() => moveLine(line.key, -1)}
              className="px-1 disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Niżej: ${nameOf(line)}`}
              disabled={index === draft.lines.length - 1}
              onClick={() => moveLine(line.key, 1)}
              className="px-1 disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Zmień drogę: ${nameOf(line)}`}
              title="Zmień drogę"
              onClick={() => onChangeRoute(line.key)}
              className="px-1"
            >
              ✎
            </button>
            <button
              type="button"
              aria-label={`Usuń linię: ${nameOf(line)}`}
              title="Usuń linię"
              onClick={() => remove(line)}
              className="px-1"
            >
              🗑
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onNewLine} className="rounded-md border border-border py-1.5">
        + Nowa linia
      </button>
      <ConfirmDialog
        open={confirm !== null}
        title="Usunąć linię?"
        description="Od tej linii odchodzą warianty — zostaną, ale stracą powiązanie z nią."
        confirmLabel="Usuń"
        destructive
        onConfirm={() => {
          if (confirm) deleteLine(confirm.key);
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
