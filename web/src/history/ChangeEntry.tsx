import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import type { ChangeOut, ObjectChangeOut } from "@/lib/api";
import { changeHeadline, fieldLabel, formatValue, formatWhen, isRestore, objectAction, objectName, objectTitle } from "./format";

interface Props {
  change: ChangeOut;
  /** The global list: names the crag and its path, and links to it. */
  showCrag?: boolean;
  onRevert: (change: ChangeOut) => void;
}

function ObjectLines({ object }: { object: ObjectChangeOut }) {
  if (object.op !== "updated") return <div className="ml-2.5 text-xs">{objectAction(object)}</div>;
  if (object.kind === "topo") return <div className="ml-2.5 text-xs">Topo: {object.summary}</div>;
  const name = objectName(object);
  const title = objectTitle(object).slice(0, objectTitle(object).length - (name?.length ?? 0));
  return (
    <>
      {object.diffs.map((diff) => (
        <div key={diff.field} className="ml-2.5 text-xs">
          {title}
          {name && <b>{name}</b>}: {fieldLabel(diff.field)}{" "}
          {diff.before !== null && (
            <>
              <del className="diff-del">{formatValue(diff.field, diff.before)}</del> →{" "}
            </>
          )}
          <ins className="diff-ins">{formatValue(diff.field, diff.after)}</ins>
        </div>
      ))}
    </>
  );
}

export function ChangeEntry({ change, showCrag, onRevert }: Props) {
  const headline = changeHeadline(change);
  const when = formatWhen(change.issued_at);

  if (change.is_import) {
    return (
      <div data-testid="change-entry" className="border-t py-2 text-xs text-muted-foreground">
        {change.author} · {when} · dane bazowe (nie do cofnięcia)
      </div>
    );
  }

  return (
    <div data-testid="change-entry" className="border-t py-2 text-sm">
      <div>
        <span className="font-semibold">{change.author}</span>
        <span className="text-xs text-muted-foreground">
          {" "}
          · {when}
          {change.comment && ` · „${change.comment}”`}
        </span>
        {showCrag && (change.crag || change.area_path.length > 0) && (
          <>
            {change.crag && <b> · {change.crag.name}</b>}
            <span className="text-xs text-muted-foreground">
              {" "}
              · {change.area_path.map((area) => area.name).join(" · ")}
            </span>
          </>
        )}
      </div>
      {headline ? <div className="ml-2.5 text-xs">{headline}</div> : change.objects.map((object) => <ObjectLines key={`${object.kind}-${object.id}`} object={object} />)}
      {change.reverts_id !== null && <div className="ml-2.5 text-xs text-muted-foreground">cofnięcie zmiany #{change.reverts_id}</div>}
      <div className="mt-1 flex items-center gap-2">
        {change.reverted_by !== null ? (
          <span className="text-xs text-muted-foreground">cofnięta przez #{change.reverted_by}</span>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => onRevert(change)}>
            {isRestore(change) ? "↶ Przywróć" : "↶ Cofnij"}
          </Button>
        )}
        {showCrag && change.crag?.slug && (
          <Button asChild variant="outline" size="sm">
            <Link to={`/skaly/${change.crag.slug}`}>Otwórz skałę</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
