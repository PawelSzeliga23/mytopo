import { useState } from "react";
import { GradeBadge } from "@/components/GradeBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEditor } from "@/editor/store";
import type { DraftRouteRef } from "@/editor/types";
import type { RouteOut } from "@/lib/api";
import { compareRoutes } from "@/lib/routes";

interface Props {
  open: boolean;
  title: string;
  routes: RouteOut[];
  onPick(route: DraftRouteRef): void;
  onClose(): void;
}

/** Choose the route a line climbs: routes without a line on this photo first, then the rest, or a new one. */
export function RoutePicker({ open, title, routes, onPick, onClose }: Props) {
  const draft = useEditor((s) => s.draft);
  const addRoute = useEditor((s) => s.addRoute);
  const removeRoute = useEditor((s) => s.removeRoute);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");

  const drawn = new Set(draft.lines.flatMap((line) => (line.route && "routeId" in line.route ? [line.route.routeId] : [])));
  const sorted = [...routes].sort(compareRoutes);
  const free = sorted.filter((route) => !drawn.has(route.id));
  const taken = sorted.filter((route) => drawn.has(route.id));

  const createRoute = () => {
    if (!name.trim()) return;
    const routeKey = addRoute(name.trim(), grade.trim() || null);
    setName("");
    setGrade("");
    onPick({ routeKey });
  };

  const row = (route: RouteOut) => (
    <li key={route.id}>
      <button
        type="button"
        onClick={() => onPick({ routeId: route.id })}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary"
      >
        <span className="flex-1 font-display">{route.name}</span>
        <GradeBadge grade={route.grade} sort={route.grade_sort} />
      </button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Wybierz drogę albo dodaj nową.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-[1fr_6rem_auto] items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createRoute();
          }}
        >
          <div>
            <Label htmlFor="new-route-name">+ Nowa droga</Label>
            <Input id="new-route-name" value={name} placeholder="Nazwa" onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="new-route-grade">Wycena</Label>
            <Input id="new-route-grade" value={grade} placeholder="np. VI.1+" onChange={(event) => setGrade(event.target.value)} />
          </div>
          <Button type="submit" disabled={!name.trim()}>
            Dodaj
          </Button>
        </form>
        {draft.newRoutes.length > 0 && (
          <ul>
            {draft.newRoutes.map((route) => (
              <li key={route.key} className="flex items-center">
                <button
                  type="button"
                  onClick={() => onPick({ routeKey: route.key })}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-secondary"
                >
                  <span className="flex-1 font-display">{route.name}</span>
                  <span className="text-xs text-muted-foreground">nowa · {route.grade ?? "bez wyceny"}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Usuń nową drogę ${route.name}`}
                  title="Usuń nową drogę (np. przy złej wycenie)"
                  onClick={() => removeRoute(route.key)}
                  className="px-2 text-muted-foreground hover:text-destructive"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        {free.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Bez linii na tym zdjęciu</h3>
            <ul>{free.map(row)}</ul>
          </section>
        )}
        {taken.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Już narysowane</h3>
            <ul>{taken.map(row)}</ul>
          </section>
        )}
        <Button type="button" variant="outline" onClick={() => onPick(null)}>
          Linia bez drogi
        </Button>
      </DialogContent>
    </Dialog>
  );
}
