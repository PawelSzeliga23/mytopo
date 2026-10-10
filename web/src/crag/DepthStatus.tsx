import { Button } from "@/components/ui/button";
import { api, type WallOut } from "@/lib/api";
import { useEditorMutation, useSession } from "@/lib/session";

/** Under the photo: the 2.5D model is being computed, or computing it failed (with a retry for editors). */
export function DepthStatus({ wall }: { wall: WallOut }) {
  const { isEditor } = useSession();
  const retry = useEditorMutation(() => api.retryDepth(wall.id), { invalidate: [["crag"]], successToast: "Ponowiono liczenie 2.5D" });
  if (!wall.image_url || (wall.depth_status !== "pending" && wall.depth_status !== "failed")) return null;
  return (
    <p data-testid="depth-status" className="flex items-center gap-2 text-[11px] text-muted-foreground">
      {wall.depth_status === "pending" ? "Model 2.5D w przygotowaniu" : "Nie udało się policzyć 2.5D"}
      {wall.depth_status === "failed" && isEditor && (
        <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" disabled={retry.isPending} onClick={() => retry.mutate(undefined)}>
          Ponów
        </Button>
      )}
    </p>
  );
}
