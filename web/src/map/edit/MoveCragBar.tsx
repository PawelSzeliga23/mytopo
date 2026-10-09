import { Button } from "@/components/ui/button";
import { api, type CragProps } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";
import { distanceMeters, formatDistance } from "./geo";
import type { LngLat } from "./mode";

interface Props {
  crag: CragProps;
  origin: LngLat;
  target: LngLat | null;
  onCancel: () => void;
  onSaved: () => void;
}

const floating = "absolute z-10 rounded-[10px] bg-background px-3 py-2 text-sm shadow-float";

export function MoveCragBar({ crag, origin, target, onCancel, onSaved }: Props) {
  const save = useEditorMutation((location: LngLat) => api.patchCrag(crag.id, { location }), {
    invalidate: [["map"], ["crag"]],
    onSuccess: onSaved,
  });
  return (
    <>
      <div role="status" className={`${floating} inset-x-3 top-3 lg:right-auto lg:w-[520px]`}>
        Przeciągnij pinezkę (albo kliknij w nowe miejsce).
        {target && <b className="ml-1">{`Przesunięto o ${formatDistance(distanceMeters(origin, target))}`}</b>}
      </div>
      <div className={`${floating} bottom-3 left-3 right-20 flex items-center justify-between gap-2 lg:right-auto lg:w-[520px]`}>
        <span className="min-w-0 truncate">
          <span className="font-display font-semibold">{crag.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{target ? `${target[1].toFixed(5)}, ${target[0].toFixed(5)}` : `${origin[1].toFixed(5)}, ${origin[0].toFixed(5)}`}</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="button" size="sm" disabled={!target || save.isPending} onClick={() => target && save.mutate(target)}>
            Zapisz położenie
          </Button>
        </span>
      </div>
    </>
  );
}
