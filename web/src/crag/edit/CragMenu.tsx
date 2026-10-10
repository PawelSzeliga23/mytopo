import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, type CragDetail, type WallOut } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";
import { formatViewHash } from "@/map/view";
import { ConfirmDialog } from "./ConfirmDialog";
import { PhotoUploadDialog } from "./PhotoUploadDialog";
import { ToSectorDialog } from "./ToSectorDialog";
import { WallEditDialog } from "./WallEditDialog";

const CRAG_ZOOM = 15;

type Open = "wall" | "photo" | "add-wall" | "delete-wall" | "to-sector" | "delete-crag" | null;

interface Props {
  crag: CragDetail;
  /** The wall shown now; the wall entries act on it. */
  wall: WallOut | null;
  /** Opens the history panel; without it the entry is hidden. */
  onHistory?: () => void;
}

export function CragMenu({ crag, wall, onHistory }: Props) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const mapAtCrag = formatViewHash({ longitude: crag.lng, latitude: crag.lat, zoom: CRAG_ZOOM });

  const deleteWall = useEditorMutation(() => api.deleteWall(wall!.id), { invalidate: [["crag", crag.slug], ["map"]], onSuccess: close });
  const deleteCrag = useEditorMutation(() => api.deleteCrag(crag.id), {
    invalidate: [["map"]],
    successToast: false,
    onSuccess: () => {
      close();
      navigate(`/${mapAtCrag}`);
      // After the page has gone, so Back does not show the deleted crag from cache.
      setTimeout(() => client.removeQueries({ queryKey: ["crag", crag.slug] }), 0);
      toast.success(`Usunięto ${crag.name}`);
    },
  });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            ⋯
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onHistory && <DropdownMenuItem onSelect={onHistory}>Historia</DropdownMenuItem>}
          <DropdownMenuItem onSelect={() => navigate(`/?przesun=${crag.id}${mapAtCrag}`)}>Przesuń na mapie</DropdownMenuItem>
          {wall && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setOpen("photo")}>{wall.image_url ? "Podmień zdjęcie" : "Dodaj zdjęcie"}</DropdownMenuItem>
              {wall.image_url && (
                <DropdownMenuItem onSelect={() => navigate(`/skaly/${crag.slug}/topo/${wall.id}`)}>Edytuj topo</DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setOpen("wall")}>Ściana: nazwa i opis</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpen("delete-wall")}>Usuń ścianę</DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen("add-wall")}>Dodaj ścianę</DropdownMenuItem>
          {crag.walls.length > 1 && <DropdownMenuItem onSelect={() => setOpen("to-sector")}>Zamień w sektor</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onSelect={() => setOpen("delete-crag")}>
            Usuń skałę
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open === "wall" && wall && <WallEditDialog wall={wall} onClose={close} />}
      {open === "photo" && wall && <PhotoUploadDialog crag={crag} wall={wall} onClose={close} />}
      {open === "add-wall" && <PhotoUploadDialog crag={crag} onClose={close} />}
      {open === "to-sector" && <ToSectorDialog crag={crag} onClose={close} />}
      <ConfirmDialog
        open={open === "delete-wall"}
        title="Usunąć ścianę?"
        description="Zdjęcie z liniami zniknie ze skały. Można to cofnąć w Ostatnich zmianach."
        confirmLabel="Usuń"
        destructive
        pending={deleteWall.isPending}
        onConfirm={() => deleteWall.mutate(undefined)}
        onCancel={close}
      />
      <ConfirmDialog
        open={open === "delete-crag"}
        title="Usunąć skałę?"
        description={`Usunąć ${crag.name} razem z ${crag.walls.length} ścianami i ${crag.routes.length} drogami? Można to cofnąć w Ostatnich zmianach.`}
        confirmLabel="Usuń"
        destructive
        pending={deleteCrag.isPending}
        onConfirm={() => deleteCrag.mutate(undefined)}
        onCancel={close}
      />
    </>
  );
}
