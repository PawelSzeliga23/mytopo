import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/crag/edit/ConfirmDialog";
import { decodeClasses, decodeDepth } from "@/crag/surface";
import type { Look } from "@/crag/Wall3D";
import { GROUND_COLOR, ROCK_COLOR } from "@/crag/wall3dMaterials";
import { wallLabel } from "@/crag/WallThumbnails";
import { SaveButton } from "@/editor/SaveBar";
import { api, ApiError, type CragDetail, type WallOut } from "@/lib/api";
import { useEditorMutation, useSession } from "@/lib/session";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { applyPatch, encodeModel, gridFromRasters, smooth, trimEdge, type ModelGrid, type Patch } from "./grid";
import { ModelCanvas, type ModelTool } from "./ModelCanvas";

const MAX_STEPS = 100;

const TOOLS: { tool: ModelTool; label: string }[] = [
  { tool: "orbit", label: "Obracanie" },
  { tool: "flatten", label: "Spłaszcz" },
  { tool: "erase", label: "Gumka" },
  { tool: "restore", label: "Przywróć" },
  { tool: "rock", label: "Maluj skałę" },
  { tool: "ground", label: "Maluj podłoże" },
];

type Switch = "auto" | "on" | "off";
const SWITCH_OF = (value: boolean | null): Switch => (value === true ? "on" : value === false ? "off" : "auto");

interface Settings {
  rockColor: string | null;
  groundColor: string | null;
  switch3d: Switch;
}

export default function ModelEditorPage() {
  const { slug = "", wallId } = useParams();
  const { isEditor, reauthenticating, requestLogin } = useSession();
  const { data: crag, isPending, error } = useQuery({ queryKey: ["crag", slug], queryFn: () => api.crag(slug) });

  if (!isEditor && !reauthenticating) {
    return (
      <main className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <p>Edycja modelu 2.5D po zalogowaniu.</p>
        <Button onClick={() => void requestLogin()}>✎ Edytuj</Button>
      </main>
    );
  }
  if (isPending) return <p className="p-4 text-muted-foreground">Wczytywanie…</p>;
  if (error || !crag) return <p className="p-4">Nie udało się wczytać skały.</p>;
  const wall = crag.walls.find((candidate) => candidate.id === Number(wallId));
  if (!wall) return <p className="p-4">Nie ma takiej ściany.</p>;
  if (wall.depth_status !== "ready" || !wall.depth_url || !wall.original_depth_url) return <p className="p-4">Ta ściana nie ma jeszcze modelu 2.5D.</p>;
  return <GridLoader key={wall.id} crag={crag} wall={wall} />;
}

async function buffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.arrayBuffer();
}

/** The current model and the worker's original (the same files while nothing was saved from the editor). */
async function loadGrid(wall: WallOut): Promise<ModelGrid> {
  const [depth, segments, origDepth, origSegments] = await Promise.all([
    buffer(wall.depth_url!),
    wall.segments_url ? buffer(wall.segments_url) : null,
    wall.original_depth_url === wall.depth_url ? null : buffer(wall.original_depth_url!),
    wall.original_segments_url && wall.original_segments_url !== wall.segments_url ? buffer(wall.original_segments_url) : null,
  ]);
  const current = decodeDepth(depth);
  const currentCls = segments ? decodeClasses(segments, current.width, current.height) : null;
  const original = origDepth ? decodeDepth(origDepth) : current;
  const originalCls = origSegments
    ? decodeClasses(origSegments, original.width, original.height)
    : wall.original_segments_url === wall.segments_url
      ? currentCls
      : null;
  return gridFromRasters(current, currentCls, original, originalCls);
}

function GridLoader({ crag, wall }: { crag: CragDetail; wall: WallOut }) {
  // Loaded once per wall: later saves keep the edited grid (a checkpoint), so undo goes on working.
  const { data: grid, error } = useQuery({ queryKey: ["model-grid", wall.id], queryFn: () => loadGrid(wall), staleTime: Infinity, gcTime: 0 });
  if (error) return <p className="p-4">Nie udało się wczytać modelu 2.5D.</p>;
  if (!grid) return <p className="p-4 text-muted-foreground">Wczytywanie modelu 2.5D…</p>;
  return <ModelEditor crag={crag} wall={wall} grid={grid} />;
}

interface Steps {
  list: Patch[];
  /** Steps applied now (list[0..index-1]). */
  index: number;
  /** `index` at the last save; null when that state cannot be reached by undo/redo any more. */
  saved: number | null;
}

/** The edit as one more undo step; steps undone before it are dropped, the oldest beyond MAX_STEPS too. */
function withStep(state: Steps, patch: Patch): Steps {
  let list = [...state.list.slice(0, state.index), patch];
  let index = state.index + 1;
  let saved = state.saved !== null && state.saved > state.index ? null : state.saved;
  if (list.length > MAX_STEPS) {
    list = list.slice(1);
    index--;
    saved = saved !== null && saved > 0 ? saved - 1 : null;
  }
  return { list, index, saved };
}

function ModelEditor({ crag, wall, grid }: { crag: CragDetail; wall: WallOut; grid: ModelGrid }) {
  const navigate = useNavigate();
  const location = useLocation();
  const desktop = useIsDesktop();
  const client = useQueryClient();
  const routes = useMemo(() => new Map(crag.routes.map((route) => [route.id, route])), [crag.routes]);
  const [steps, setSteps] = useState<Steps>({ list: [], index: 0, saved: 0 });
  const [revision, setRevision] = useState(0);
  const [tool, setTool] = useState<ModelTool>("orbit");
  const [brush, setBrush] = useState(8);
  const [look, setLook] = useState<Look>("holo");
  const [relief, setRelief] = useState(0.25);
  const [showRoutes, setShowRoutes] = useState(true);
  const initial: Settings = { rockColor: wall.rock_color, groundColor: wall.ground_color, switch3d: SWITCH_OF(wall.depth_enabled) };
  const [settings, setSettings] = useState<Settings>(initial);
  const [savedSettings, setSavedSettings] = useState<Settings>(initial);
  const [baseModel, setBaseModel] = useState<number | null>(wall.model_version);
  const [conflict, setConflict] = useState<{ comment: string | null; current: number | null } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const { list, index, saved } = steps;
  const stepChanges = saved === null ? Math.max(1, index) : Math.abs(index - saved);
  const changedSettings = (Object.keys(settings) as (keyof Settings)[]).filter((key) => settings[key] !== savedSettings[key]);
  const changes = stepChanges + changedSettings.length;

  const push = (patch: Patch | null) => {
    if (!patch) return;
    setSteps(withStep(steps, patch));
    setRevision((n) => n + 1);
  };
  const undo = () => {
    if (steps.index === 0) return;
    applyPatch(grid, steps.list[steps.index - 1], "undo");
    setSteps({ ...steps, index: steps.index - 1 });
    setRevision((n) => n + 1);
  };
  const redo = () => {
    if (steps.index >= steps.list.length) return;
    applyPatch(grid, steps.list[steps.index], "redo");
    setSteps({ ...steps, index: steps.index + 1 });
    setRevision((n) => n + 1);
  };

  const save = useEditorMutation(
    ({ form }: { form: FormData; settingsSent: Settings; index: number }) => api.saveWallModel(wall.id, form),
    {
      successToast: "Zapisano model 2.5D",
      invalidate: [["crag", crag.slug]],
      onSuccess: (result, { settingsSent, index: sentIndex }) => {
        setBaseModel(result.model_version);
        setSteps((current) => ({ ...current, saved: sentIndex }));
        setSavedSettings(settingsSent);
        setRevision((n) => n + 1);
      },
    },
  );
  const submit = (comment: string | null, base: number | null) => {
    const form = new FormData();
    form.append("base_model", base === null ? "" : String(base));
    if (stepChanges > 0) {
      const files = encodeModel(grid);
      form.append("depth", files.depth, "depth.png");
      form.append("segments", files.segments, "segments.png");
    }
    if (settings.rockColor !== savedSettings.rockColor) form.append("rock_color", settings.rockColor ?? "default");
    if (settings.groundColor !== savedSettings.groundColor) form.append("ground_color", settings.groundColor ?? "default");
    if (settings.switch3d !== savedSettings.switch3d) form.append("depth_enabled", settings.switch3d);
    if (comment) form.append("comment", comment);
    save.mutate(
      { form, settingsSent: settings, index },
      {
        onError: (error) => {
          if (error instanceof ApiError && error.code === "model_conflict") {
            setConflict({ comment, current: (error.body as { current_model?: number | null } | null)?.current_model ?? null });
          }
        },
      },
    );
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const key = event.key.toLowerCase();
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (changes === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

  // Back, not forward: like the topo editor, so the crag page's "← Mapa" (history back) reaches the map again.
  const exit = () => (location.key !== "default" ? navigate(-1) : navigate(`/skaly/${crag.slug}`, { replace: true }));
  const wallName = wallLabel(wall, crag.walls.indexOf(wall));
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const panel = (
    <div className="flex flex-col gap-4 text-sm">
      <Section title="Narzędzia">
        <div role="toolbar" aria-label="Narzędzia modelu" className="grid grid-cols-2 gap-1.5">
          {TOOLS.map((item) => (
            <Choice key={item.tool} pressed={tool === item.tool} onClick={() => setTool(item.tool)}>
              {item.label}
            </Choice>
          ))}
        </div>
        <label className="flex items-center gap-2">
          pędzel
          <input aria-label="Rozmiar pędzla" type="range" min={2} max={30} step={1} value={brush} onChange={(event) => setBrush(Number(event.target.value))} className="flex-1" />
          <span className="w-6 text-right tabular-nums">{brush}</span>
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => push(smooth(grid))}>
            Wygładź
          </Button>
          <Button variant="outline" size="sm" onClick={() => push(trimEdge(grid))}>
            Przytnij krawędź
          </Button>
        </div>
      </Section>
      <Section title="Widok">
        <div className="grid grid-cols-2 gap-1.5">
          <Choice pressed={look === "holo"} onClick={() => setLook("holo")}>
            hologram
          </Choice>
          <Choice pressed={look === "photo"} onClick={() => setLook("photo")}>
            zdjęcie
          </Choice>
        </div>
        <label className="flex items-center gap-2">
          głębia
          <input aria-label="Głębia podglądu" type="range" min={0} max={0.6} step={0.01} value={relief} onChange={(event) => setRelief(Number(event.target.value))} className="flex-1" />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showRoutes} onChange={(event) => setShowRoutes(event.target.checked)} />
          drogi
        </label>
      </Section>
      <Section title="Ściana">
        <ColorField label="Kolor skały" value={settings.rockColor} fallback={ROCK_COLOR} onChange={(value) => set("rockColor", value)} />
        <ColorField label="Kolor podłoża" value={settings.groundColor} fallback={GROUND_COLOR} onChange={(value) => set("groundColor", value)} />
        <div className="flex flex-col gap-1">
          <span>2.5D na stronie skały</span>
          <div role="radiogroup" aria-label="2.5D na stronie skały" className="grid grid-cols-3 gap-1.5">
            {(["auto", "on", "off"] as const).map((value) => (
              <Choice key={value} pressed={settings.switch3d === value} onClick={() => set("switch3d", value)}>
                {{ auto: "auto", on: "zawsze", off: "nigdy" }[value]}
              </Choice>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-2 py-1.5">
        <Button variant="outline" size="sm" onClick={() => (changes > 0 ? setLeaving(true) : exit())} aria-label="Wyjdź z edytora">
          {desktop ? "← Wyjdź" : "✕"}
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-display text-lg font-bold">{desktop ? `${crag.name} · ${wallName} — model 2.5D` : wallName}</h1>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" aria-label="Cofnij" title="Cofnij (Ctrl+Z)" disabled={index === 0} onClick={undo}>
            ↶
          </Button>
          <Button variant="outline" size="sm" aria-label="Ponów" title="Ponów (Ctrl+Shift+Z)" disabled={index >= list.length} onClick={redo}>
            ↷
          </Button>
        </div>
        <SaveButton count={changes} blocked={null} pending={save.isPending} title="Zapisać model 2.5D?" onSave={(comment) => submit(comment, baseModel)} />
      </header>
      <div className={cn("flex min-h-0 flex-1", !desktop && "flex-col")}>
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black">
          <ModelCanvas
            grid={grid}
            revision={revision}
            wall={wall}
            routes={routes}
            tool={tool}
            brush={brush}
            look={look}
            relief={relief}
            showRoutes={showRoutes}
            rockColor={settings.rockColor}
            groundColor={settings.groundColor}
            onStroke={push}
          />
          <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-foreground/85 px-2 py-1 text-xs text-background">
            {tool === "orbit" ? "Przeciągnij, żeby obrócić · kółko / dwa palce przybliżają" : "Przeciągnij po modelu"}
          </span>
        </div>
        <aside className={cn("overflow-y-auto border-border p-3", desktop ? "w-72 border-l" : "max-h-[42dvh] border-t bg-secondary")}>{panel}</aside>
      </div>
      <ConfirmDialog
        open={leaving}
        title="Porzucić zmiany?"
        description="Niezapisane poprawki modelu przepadną."
        confirmLabel="Wyjdź"
        destructive
        onConfirm={exit}
        onCancel={() => setLeaving(false)}
      />
      <ConfirmDialog
        open={conflict !== null}
        title="Ktoś zapisał model w międzyczasie"
        description="Możesz zapisać swoje poprawki na jego miejsce (jego wersja zostanie w historii) albo wrócić do edycji."
        confirmLabel="Nadpisz moim"
        cancelLabel="Anuluj"
        onConfirm={() => {
          if (!conflict) return;
          setConflict(null);
          setBaseModel(conflict.current);
          void client.invalidateQueries({ queryKey: ["crag", crag.slug] });
          submit(conflict.comment, conflict.current);
        }}
        onCancel={() => setConflict(null)}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Choice({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="rounded-md border border-border bg-background px-2 py-1.5 text-xs aria-pressed:bg-foreground aria-pressed:text-background"
    >
      {children}
    </button>
  );
}

function ColorField({ label, value, fallback, onChange }: { label: string; value: string | null; fallback: string; onChange: (value: string | null) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input aria-label={label} type="color" value={value ?? fallback} onChange={(event) => onChange(event.target.value)} className="h-7 w-9" />
      <span className="flex-1">{label.toLowerCase()}</span>
      {value !== null && (
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onChange(null)}>
          domyślny
        </button>
      )}
    </label>
  );
}
