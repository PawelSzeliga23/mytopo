import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, type AreaProps, type AreaRef, type CragDetail, type CragPatch } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";
import { AreaSelect } from "@/map/edit/AreaSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { ASPECTS, CRAG_FIELDS, draftToPatch, inCompassOrder, toDraft, type CragDraft, type CragField } from "./fields";

interface Props {
  crag: CragDetail;
  onDone: () => void;
}

interface Areas {
  regions: AreaProps[];
  sectors: AreaProps[];
}

interface FieldProps {
  field: CragField;
  draft: CragDraft;
  areas: Areas;
  /** The crag's area as it is now: listed even when it is not a region or sector (a crag directly in an obszar). */
  currentArea?: AreaRef;
  onChange: (value: CragDraft[keyof CragDraft]) => void;
}

function FieldInput({ field, draft, areas, currentArea, onChange }: FieldProps) {
  const id = `crag-${field.key}`;
  const value = draft[field.key];
  switch (field.kind) {
    case "area": {
      const listed = [...areas.regions, ...areas.sectors].some((area) => String(area.id) === value);
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          <AreaSelect id={id} value={value as string} onChange={onChange} regions={areas.regions} sectors={areas.sectors}>
            {!listed && currentArea && String(currentArea.id) === value && <option value={value}>{currentArea.name}</option>}
          </AreaSelect>
        </div>
      );
    }
    case "aspects":
      return (
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">{field.label}</legend>
          {ASPECTS.map((aspect) => (
            <label key={aspect} className="flex cursor-pointer items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs has-[:checked]:bg-brand has-[:checked]:text-white">
              <input
                type="checkbox"
                className="sr-only"
                checked={draft.aspects.includes(aspect)}
                onChange={(event) => onChange(inCompassOrder(event.target.checked ? [...draft.aspects, aspect] : draft.aspects.filter((item) => item !== aspect)))}
              />
              {aspect}
            </label>
          ))}
        </fieldset>
      );
    case "tristate":
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          <select
            id={id}
            value={value as string}
            onChange={(event) => onChange(event.target.value as CragDraft["child_friendly"])}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-base md:text-sm"
          >
            <option value="">brak</option>
            <option value="tak">tak</option>
            <option value="nie">nie</option>
          </select>
        </div>
      );
    case "textarea":
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          <Textarea id={id} value={value as string} onChange={(event) => onChange(event.target.value)} />
        </div>
      );
    default:
      return (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          <Input
            id={id}
            type={field.kind === "number" ? "number" : "text"}
            inputMode={field.kind === "number" ? "decimal" : undefined}
            step={field.kind === "number" ? "any" : undefined}
            value={value as string}
            required={field.key === "name"}
            placeholder={field.hint}
            onChange={(event) => onChange(event.target.value)}
          />
        </div>
      );
  }
}

/** Edit mode of the whole crag (mockup variant B): all fields at once, one history entry for the whole session. */
export function CragEditForm({ crag, onDone }: Props) {
  const navigate = useNavigate();
  // Frozen at the start of editing: a background refetch must not make untouched fields look changed.
  const [original] = useState(() => toDraft(crag));
  const [draft, setDraft] = useState(original);
  const [comment, setComment] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Same keys as the map, so they are usually cached; the field appears once the lists are there.
  const regions = useQuery({ queryKey: ["map", "regions"], queryFn: api.regions });
  const sectors = useQuery({ queryKey: ["map", "sectors"], queryFn: api.sectorHulls });
  const areas: Areas = {
    regions: regions.data?.features?.map((feature) => feature.properties) ?? [],
    sectors: sectors.data?.features?.map((feature) => feature.properties) ?? [],
  };
  const patch = draftToPatch(original, draft);
  const changed = Object.keys(patch).length;

  const save = useEditorMutation((body: CragPatch) => api.patchCrag(crag.id, body), {
    invalidate: [["crag", crag.slug], ["map"]],
    onSuccess: (result) => {
      // A rename changes the slug, so the address of this page changes with it.
      if (result.slug && result.slug !== crag.slug) navigate(`/skaly/${result.slug}`, { replace: true });
      onDone();
    },
  });

  useEffect(() => {
    if (changed === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (changed === 0) return;
    save.mutate({ ...patch, comment: comment.trim() || null });
  }

  function cancel() {
    if (changed > 0) setConfirmLeave(true);
    else onDone();
  }

  return (
    <form onSubmit={submit} aria-label="Edycja skały" className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CRAG_FIELDS.filter((field) => field.kind !== "area" || areas.regions.length > 0).map((field) => (
          <div key={field.key} className={field.wide ? "sm:col-span-2" : undefined}>
            <FieldInput field={field} draft={draft} areas={areas} currentArea={crag.path.at(-1)} onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))} />
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-2 bg-secondary px-4 py-2.5 lg:mx-0 lg:rounded-[10px]">
        <Input aria-label="Komentarz" placeholder="Komentarz (opcjonalnie)…" value={comment} onChange={(event) => setComment(event.target.value)} className="min-w-40 flex-1" />
        <Button type="button" variant="outline" onClick={cancel}>
          Anuluj
        </Button>
        <Button type="submit" disabled={changed === 0 || save.isPending}>
          {`Zapisz zmiany (${changed})`}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmLeave}
        title="Porzucić zmiany?"
        description="Wprowadzone zmiany nie zostały zapisane."
        confirmLabel="Porzuć"
        cancelLabel="Wróć do edycji"
        destructive
        onConfirm={onDone}
        onCancel={() => setConfirmLeave(false)}
      />
    </form>
  );
}
