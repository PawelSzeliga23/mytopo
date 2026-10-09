import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type CragDetail } from "@/lib/api";
import { countLabel, DROGI, SCIANY, SKALY } from "@/lib/plural";
import { useEditorMutation, useLoginOnUnauthorized } from "@/lib/session";
import { formatViewHash } from "@/map/view";

const CRAG_ZOOM = 15;

export function ToSectorDialog({ crag, onClose }: { crag: CragDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const preview = useQuery({ queryKey: ["to-sector-preview", crag.id], queryFn: () => api.toSectorPreview(crag.id), retry: false, gcTime: 0 });
  const unauthorized = useLoginOnUnauthorized(preview.error, () => void preview.refetch());
  // A crag converted into a region (it sat in an obszar) is not a sektor.
  const noun = preview.data?.kind === "region" ? "region" : "sektor";
  const convert = useEditorMutation(() => api.toSector(crag.id), {
    invalidate: [["map"]],
    successToast: false,
    onSuccess: () => {
      onClose();
      navigate(`/${formatViewHash({ longitude: crag.lng, latitude: crag.lat, zoom: CRAG_ZOOM })}`);
      setTimeout(() => client.removeQueries({ queryKey: ["crag", crag.slug] }), 0);
      toast.success(`Zamieniono w ${noun} — ustaw skały na mapie`);
    },
  });
  const data = preview.data;
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Zamień w ${noun}`}</DialogTitle>
          <DialogDescription>
            {data
              ? `Powstanie ${data.kind} ${data.sector_name} i ${countLabel(data.crags.length, SKALY)} (z ${countLabel(crag.walls.length, SCIANY)}); na kilku ścianach jest ${countLabel(data.copied_routes, DROGI)} — dostaną kopie. Do ustawienia na mapie: ${countLabel(data.unplaced, SKALY)}.`
              : preview.error
                ? unauthorized
                  ? "Zaloguj się, aby zobaczyć podgląd."
                  : preview.error.message
                : "Wczytywanie…"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Anuluj
          </Button>
          <Button type="button" disabled={!data || convert.isPending} onClick={() => convert.mutate(undefined)}>
            Zamień
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
