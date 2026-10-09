import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, type RouteCreate, type RouteOut, type RoutePatch } from "@/lib/api";
import { changedFields } from "@/lib/patch";
import { useEditorMutation } from "@/lib/session";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { ConfirmDialog } from "./ConfirmDialog";

/** The form's working copy: every value is text, so inputs stay controlled. */
interface RouteDraft {
  name: string;
  grade: string;
  length_m: string;
  protection: string;
  first_ascent: string;
  year: string;
  number: string;
  description: string;
}

interface RouteField {
  key: keyof RouteDraft;
  label: string;
  kind?: "number" | "textarea";
  hint?: string;
  /** Only an existing route has a number (the API does not take it on create). */
  existingOnly?: boolean;
}

const FIELDS: RouteField[] = [
  { key: "name", label: "Nazwa" },
  { key: "grade", label: "Wycena", hint: "np. VI.1+, VI.2/3" },
  { key: "length_m", label: "Długość (m)", kind: "number" },
  { key: "protection", label: "Asekuracja" },
  { key: "first_ascent", label: "Autor" },
  { key: "year", label: "Rok", kind: "number" },
  { key: "number", label: "Numer", kind: "number", existingOnly: true },
  { key: "description", label: "Opis", kind: "textarea" },
];

const text = (value: string | null) => value ?? "";
const num = (value: number | null) => (value === null ? "" : String(value));

function toDraft(route: RouteOut | null): RouteDraft {
  return {
    name: route?.name ?? "",
    grade: text(route?.grade ?? null),
    length_m: num(route?.length_m ?? null),
    protection: text(route?.protection ?? null),
    first_ascent: text(route?.first_ascent ?? null),
    year: num(route?.year ?? null),
    number: num(route?.number ?? null),
    description: text(route?.description ?? null),
  };
}

const orNull = (value: string) => (value.trim() === "" ? null : value);
const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value.replace(",", ".")));

const CONVERT: { [K in keyof RouteDraft]: (value: string) => unknown } = {
  name: (value) => value.trim(),
  grade: (value) => orNull(value)?.trim() ?? null,
  length_m: numberOrNull,
  protection: orNull,
  first_ascent: orNull,
  year: numberOrNull,
  number: numberOrNull,
  description: orNull,
};

function draftToPatch(original: RouteDraft, draft: RouteDraft): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(changedFields(original, draft)) as (keyof RouteDraft)[]) patch[key] = CONVERT[key](draft[key]);
  return patch;
}

interface Props {
  cragId: number;
  slug: string;
  /** null = a new route. */
  route: RouteOut | null;
  onClose: () => void;
}

function RouteForm({ cragId, slug, route, onClose }: Props) {
  // Frozen when the panel opens: a background refetch must not make untouched fields look changed.
  const [original] = useState(() => toDraft(route));
  const [draft, setDraft] = useState(original);
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch = draftToPatch(original, draft);
  const changed = Object.keys(patch).length;
  const canSave = changed > 0 && draft.name.trim() !== "";
  const invalidate = [["crag", slug], ["map"]];

  const save = useEditorMutation(
    (body: RoutePatch | RouteCreate) => (route ? api.patchRoute(route.id, body as RoutePatch) : api.createRoute(cragId, body as RouteCreate)),
    { invalidate, onSuccess: onClose },
  );
  const remove = useEditorMutation(() => api.deleteRoute(route!.id, comment.trim() || undefined), { invalidate, onSuccess: onClose });

  const gradeError = save.error instanceof ApiError && save.error.status === 422 && save.error.code === "invalid_grade" ? save.error.message : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    save.mutate({ ...patch, comment: comment.trim() || null } as RoutePatch);
  }

  return (
    <form onSubmit={submit} aria-label={route ? "Edycja drogi" : "Nowa droga"} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3">
        {FIELDS.filter((field) => route || !field.existingOnly).map((field) => {
          const id = `route-${field.key}`;
          const invalid = field.key === "grade" && gradeError !== null;
          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label htmlFor={id}>{field.label}</Label>
              {field.kind === "textarea" ? (
                <Textarea id={id} value={draft[field.key]} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
              ) : (
                <Input
                  id={id}
                  type={field.kind === "number" ? "number" : "text"}
                  inputMode={field.kind === "number" ? "decimal" : undefined}
                  step={field.kind === "number" ? "any" : undefined}
                  value={draft[field.key]}
                  placeholder={field.hint}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? `${id}-error` : undefined}
                  onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              )}
              {invalid && (
                <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                  {gradeError}
                </p>
              )}
            </div>
          );
        })}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="route-comment">Komentarz</Label>
          <Input id="route-comment" placeholder="Komentarz (opcjonalnie)…" value={comment} onChange={(event) => setComment(event.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t px-4 py-3">
        {route && (
          <Button type="button" variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            Usuń
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="submit" disabled={!canSave || save.isPending}>
            Zapisz
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={`Usunąć drogę „${route?.name ?? ""}”?`}
        description="Droga zniknie z listy i z topo. Zmianę można cofnąć w historii."
        confirmLabel="Usuń"
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSettled: () => setConfirmDelete(false) })}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}

/**
 * Side panel for one route (mockup variant C): a sheet on the right that leaves the topo visible, a drawer from the bottom on phones.
 * The caller keeps it mounted while open, even when the session lapses, so what was typed survives a re-login.
 */
export function RouteEditPanel(props: Props) {
  const isDesktop = useIsDesktop();
  const title = props.route ? props.route.name : "Nowa droga";
  const description = props.route ? "Edycja drogi" : "Dodawanie drogi do skały";

  if (isDesktop) {
    return (
      <Sheet open modal={false} onOpenChange={(open) => !open && props.onClose()}>
        <SheetContent
          showOverlay={false}
          showCloseButton={false}
          className="w-[360px] sm:max-w-[360px]"
          // The topo beside the panel stays clickable (it selects lines), so clicking it must not close the panel.
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <RouteForm {...props} />
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Drawer open dismissible={false}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <RouteForm {...props} />
      </DrawerContent>
    </Drawer>
  );
}
