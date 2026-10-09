import { Button } from "@/components/ui/button";
import { countLabel, DROGI, SKALY } from "@/lib/plural";

interface Props {
  crags: number;
  routes: number;
  onCancel: () => void;
  onNext: () => void;
}

const floating = "absolute z-10 rounded-[10px] bg-background px-3 py-2 text-sm shadow-float";

export function NewSectorBar({ crags, routes, onCancel, onNext }: Props) {
  return (
    <>
      <div role="status" className={`${floating} inset-x-3 top-3 lg:right-auto lg:w-[520px]`}>
        Klikaj skały, które mają wejść do sektora (klik ponownie odznacza). Obrys liczy się na żywo.
      </div>
      <div className={`${floating} bottom-3 left-3 right-20 flex items-center justify-between gap-2 lg:right-auto lg:w-[520px]`}>
        <span>
          <b>{countLabel(crags, SKALY)}</b>
          {` · ${countLabel(routes, DROGI)}`}
        </span>
        <span className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Anuluj
          </Button>
          <Button type="button" size="sm" disabled={crags === 0} onClick={onNext}>
            Dalej
          </Button>
        </span>
      </div>
    </>
  );
}
