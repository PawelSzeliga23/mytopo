import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, ApiError, type ChangeOut, type RevertConflict } from "@/lib/api";
import { useEditorMutation } from "@/lib/session";
import { ConflictDialog } from "./ConflictDialog";

interface Revert {
  change: ChangeOut;
  mode?: "safe" | "all";
}

/** Reverts a transaction; a conflict opens a dialog to choose what to do, any other error is a toast. */
export function useRevert(): { revert: (change: ChangeOut) => void; dialog: ReactNode } {
  const [conflict, setConflict] = useState<{ change: ChangeOut; conflicts: RevertConflict[] } | null>(null);
  const mutation = useEditorMutation(({ change, mode }: Revert) => api.revert(change.id, mode), {
    invalidate: [["changes"], ["crag"], ["map"]],
    successToast: false,
  });

  function run(change: ChangeOut, mode?: "safe" | "all") {
    mutation.mutate(
      { change, mode },
      {
        onSuccess: (result) => {
          setConflict(null);
          if (result.transaction_id === null) toast.info("Nic do cofnięcia");
          else toast.success(`Cofnięto zmianę #${change.id}`);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === "revert_conflict") {
            const conflicts = (error.body as { conflicts?: RevertConflict[] } | null)?.conflicts ?? [];
            setConflict({ change, conflicts });
          } else {
            setConflict(null); // the mutation already showed the message (e.g. missing_parent)
          }
        },
      },
    );
  }

  const dialog = conflict && (
    <ConflictDialog
      change={conflict.change}
      conflicts={conflict.conflicts}
      pending={mutation.isPending}
      onCancel={() => setConflict(null)}
      onSafe={() => run(conflict.change, "safe")}
      onAll={() => run(conflict.change, "all")}
    />
  );
  return { revert: (change) => run(change), dialog };
}
