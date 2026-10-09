import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type CragDetail } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";
import { formatViewHash } from "@/map/view";

const CRAG_ZOOM = 15;

export function ToSectorDialog({ crag, onClose }: { crag: CragDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const preview = useQuery({ queryKey: ["to-sector-preview", crag.id], queryFn: () => api.toSectorPreview(crag.id), retry: false, gcTime: 0 });
  const convert = useEditorMutation(() => api.toSector(crag.id), {
    invalidate: [["map"]],
    onSuccess: () => {
      onClose();
      navigate(`/${formatViewHash({ longitude: crag.lng, latitude: crag.lat, zoom: CRAG_ZOOM })}`);
      toast.success("Zamieniono w sektor — ustaw skały na mapie");
    },
  });
  const data = preview.data;
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zamień w sektor</DialogTitle>
          <DialogDescription>
            {data
              ? `Powstanie sektor ${data.sector_name} i ${data.crags.length} skały (z ${crag.walls.length} ścian); ${data.copied_routes} dróg występuje na kilku ścianach — dostaną kopie. ${data.unplaced} skał trzeba będzie ustawić na mapie.`
              : preview.error
                ? preview.error.message
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
