import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ConfirmDialog } from "@/crag/edit/ConfirmDialog";
import { wallLabel } from "@/crag/WallThumbnails";
import { countChanges, draftFromWall, loadLocal, saveLocal, clearLocal } from "@/editor/draft";
import { EditorCanvas, type Tool } from "@/editor/EditorCanvas";
import { LinesPanel } from "@/editor/LinesPanel";
import { PointPanel } from "@/editor/PointPanel";
import { RoutePicker } from "@/editor/RoutePicker";
import { useEditor } from "@/editor/store";
import { Toolbar } from "@/editor/Toolbar";
import type { Draft, DraftRouteRef } from "@/editor/types";
import { api, type CragDetail, type WallOut } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useElementSize } from "@/lib/useElementSize";
import { useHtmlImage } from "@/lib/useHtmlImage";
import { useIsDesktop } from "@/lib/useMediaQuery";

const SHORTCUTS: Record<string, Tool> = {
  v: "select",
  n: "line",
  p: "point",
  w: "variant",
};
const AUTOSAVE_MS = 300;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function EditorPage() {
  const { slug = "", wallId } = useParams();
  const { isEditor, reauthenticating, requestLogin } = useSession();
  const { data: crag, isPending, error } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });

  if (!isEditor && !reauthenticating) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <p>Edycja topo po zalogowaniu.</p>
        <Button onClick={() => void requestLogin()}>✎ Edytuj</Button>
      </main>
    );
  }
  if (isPending) return <p className="p-4 text-muted-foreground">Wczytywanie…</p>;
  if (error || !crag) return <p className="p-4">Nie udało się wczytać skały.</p>;
  const wall = crag.walls.find((candidate) => candidate.id === Number(wallId));
  if (!wall) return <p className="p-4">Nie ma takiej ściany.</p>;
  if (!wall.image_url) return <p className="p-4">Ta ściana nie ma zdjęcia.</p>;
  return <Editor key={wall.id} crag={crag} wall={wall} />;
}

type Prompt = {
  kind: "draft";
  draft: Draft;
  savedAt: string;
  stale: boolean;
} | null;
type Picker = { mode: "new" } | { mode: "change"; lineKey: string } | null;

function Editor({ crag, wall }: { crag: CragDetail; wall: WallOut }) {
  const navigate = useNavigate();
  const location = useLocation();
  const desktop = useIsDesktop();
  const { image } = useHtmlImage(wall.image_url);
  const holder = useRef<HTMLDivElement>(null);
  const size = useElementSize(holder);
  const routes = useMemo(() => new Map(crag.routes.map((route) => [route.id, route])), [crag.routes]);
  const [base] = useState<Draft>(() => draftFromWall(wall));
  const [prompt, setPrompt] = useState<Prompt>(() => {
    const local = loadLocal(wall.id);
    if (!local || countChanges(draftFromWall(wall), local.draft) === 0) return null;
    return {
      kind: "draft",
      draft: local.draft,
      savedAt: local.savedAt,
      stale: local.draft.baseVersion < wall.version,
    };
  });
  const [tool, setTool] = useState<Tool>("select");
  const [detach, setDetach] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [linesOpen, setLinesOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const draft = useEditor((s) => s.draft);
  const selectedLineKey = useEditor((s) => s.selectedLineKey);
  const selectedPointKey = useEditor((s) => s.selectedPointKey);
  const canUndo = useStore(useEditor.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useEditor.temporal, (s) => s.futureStates.length > 0);
  const changes = countChanges(base, draft);
  const wallName = wallLabel(wall, crag.walls.indexOf(wall));

  useEffect(() => {
    useEditor.getState().load(draftFromWall(wall), {
      width: wall.image_width ?? 1600,
      height: wall.image_height ?? 1200,
    });
    // Loaded once per wall; later saves rebase the draft instead (Task 6).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wall.id]);

  // Keep the draft on this device while it differs from the saved topo — not while the restore question is open.
  useEffect(() => {
    if (prompt) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useEditor.subscribe((state, previous) => {
      if (state.draft === previous.draft) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (countChanges(base, state.draft) > 0) saveLocal(state.draft);
        else clearLocal(state.draft.wallId);
      }, AUTOSAVE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [prompt, base]);

  const chooseTool = (next: Tool) => {
    if (next === "line") setPicker({ mode: "new" });
    else setTool(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const temporal = useEditor.temporal.getState();
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (ctrl && key === "z") {
        event.preventDefault();
        if (event.shiftKey) temporal.redo();
        else temporal.undo();
      } else if (ctrl && key === "y") {
        event.preventDefault();
        temporal.redo();
      } else if (!ctrl && SHORTCUTS[key]) {
        chooseTool(SHORTCUTS[key]);
      } else if (event.key === "Enter" || event.key === "Escape") {
        if (tool !== "select") setTool("select");
        else if (event.key === "Escape") useEditor.getState().select(null, null);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        const { selectedLineKey: line, selectedPointKey: point, deletePoint } = useEditor.getState();
        if (line && point) {
          event.preventDefault();
          deletePoint(line, point);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Back, not forward: the editor leaves the history, so the crag page's "← Mapa" (history back) reaches the map again.
  const exit = () => (location.key !== "default" ? navigate(-1) : navigate(`/skaly/${crag.slug}`, { replace: true }));
  const pick = (route: DraftRouteRef) => {
    const store = useEditor.getState();
    if (picker?.mode === "change") store.setRoute(picker.lineKey, route);
    else {
      store.newLine(route);
      setTool("line");
    }
    setPicker(null);
  };

  const hint =
    tool === "line" || tool === "point"
      ? selectedLineKey
        ? "Klikaj kolejne punkty od dołu do góry · Enter kończy"
        : "Najpierw wybierz linię"
      : tool === "variant"
        ? "Kliknij punkt, od którego odchodzi wariant"
        : selectedPointKey
          ? "Przeciągnij punkt · klik na linii wstawia punkt"
          : "Kliknij linię, żeby ją edytować";

  const undoRedo = (
    <div className="flex gap-1">
      <Button
        variant="outline"
        size="sm"
        aria-label="Cofnij"
        title="Cofnij (Ctrl+Z)"
        disabled={!canUndo}
        onClick={() => useEditor.temporal.getState().undo()}
      >
        ↶
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label="Ponów"
        title="Ponów (Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={() => useEditor.temporal.getState().redo()}
      >
        ↷
      </Button>
    </div>
  );
  const saveButton = (
    <Button size="sm" disabled title="Zapis w następnym kroku">
      Zapisz
      {changes > 0 ? ` (${changes} ${changes === 1 ? "zmiana" : "zmian"})` : ""}
    </Button>
  );
  const linesPanel = (
    <LinesPanel
      routes={routes}
      onNewLine={() => setPicker({ mode: "new" })}
      onChangeRoute={(lineKey) => setPicker({ mode: "change", lineKey })}
    />
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Button variant="outline" size="sm" onClick={() => (changes > 0 ? setLeaving(true) : exit())} aria-label="Wyjdź z edytora">
          {desktop ? "← Wyjdź" : "✕"}
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold">
          {desktop ? `${crag.name} · ${wallName} — edycja topo` : wallName}
        </h1>
        {undoRedo}
        {desktop && changes > 0 && <span className="text-xs text-muted-foreground">szkic zapisany lokalnie</span>}
        {saveButton}
      </header>
      <div className="flex min-h-0 flex-1">
        {desktop && (
          <div className="border-r border-border p-2">
            <Toolbar tool={tool} onTool={chooseTool} orientation="vertical" />
          </div>
        )}
        <div ref={holder} className="relative min-w-0 flex-1 overflow-hidden bg-black">
          {image && size.width > 0 && (
            <EditorCanvas image={image} routes={routes} size={size} tool={tool} detach={detach} onVariantStarted={() => setTool("point")} />
          )}
          <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-foreground/85 px-2 py-1 text-xs text-background">
            {hint}
          </span>
          {tool !== "select" && (
            <Button size="sm" className="absolute right-2 top-2" onClick={() => setTool("select")}>
              Gotowe
            </Button>
          )}
        </div>
        {desktop && (
          <aside className="flex w-72 flex-col gap-4 overflow-y-auto border-l border-border p-3">
            {linesPanel}
            <PointPanel detach={detach} onDetach={setDetach} />
          </aside>
        )}
      </div>
      {!desktop && (
        <footer className="flex flex-col gap-2 border-t border-border bg-secondary p-2">
          <PointPanel detach={detach} onDetach={setDetach} />
          <Toolbar tool={tool} onTool={chooseTool} orientation="horizontal" onLines={() => setLinesOpen(true)} />
        </footer>
      )}
      {!desktop && (
        <Drawer open={linesOpen} onOpenChange={setLinesOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Linie</DrawerTitle>
              <DrawerDescription className="sr-only">Linie na zdjęciu</DrawerDescription>
            </DrawerHeader>
            <div className="max-h-[60dvh] overflow-y-auto px-4 pb-4">{linesPanel}</div>
          </DrawerContent>
        </Drawer>
      )}
      <RoutePicker
        open={picker !== null}
        title={picker?.mode === "change" ? "Droga tej linii" : "Nowa linia — która droga?"}
        routes={crag.routes}
        onPick={pick}
        onClose={() => setPicker(null)}
      />
      <ConfirmDialog
        open={prompt !== null && !prompt.stale}
        title={`Masz niezapisany szkic z ${prompt ? time(prompt.savedAt) : ""}`}
        description="Możesz wrócić do niego albo zacząć od zapisanego topo."
        confirmLabel="Przywróć"
        cancelLabel="Porzuć"
        onConfirm={() => {
          if (prompt) useEditor.getState().load(prompt.draft, useEditor.getState().image);
          setPrompt(null);
        }}
        onCancel={() => {
          clearLocal(wall.id);
          setPrompt(null);
        }}
      />
      <ConfirmDialog
        open={prompt !== null && prompt.stale}
        title="Ktoś zapisał zmiany po Twoim szkicu"
        description={
          prompt
            ? `Szkic z ${time(prompt.savedAt)} powstał na starszej wersji topo. Przywrócony szkic przy zapisie zgłosi konflikt.`
            : undefined
        }
        confirmLabel="Przywróć mimo to"
        cancelLabel="Porzuć szkic"
        onConfirm={() => {
          if (prompt) useEditor.getState().load(prompt.draft, useEditor.getState().image);
          setPrompt(null);
        }}
        onCancel={() => {
          clearLocal(wall.id);
          setPrompt(null);
        }}
      />
      <ConfirmDialog
        open={leaving}
        title="Porzucić zmiany?"
        description="Szkic zostanie na tym urządzeniu."
        confirmLabel="Wyjdź"
        destructive
        onConfirm={exit}
        onCancel={() => setLeaving(false)}
      />
    </div>
  );
}
