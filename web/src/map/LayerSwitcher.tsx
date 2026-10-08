import { BASE_LAYERS, type BaseLayer } from "@/map/style";

export function LayerSwitcher({ value, onChange }: { value: BaseLayer; onChange: (base: BaseLayer) => void }) {
  return (
    <div
      role="group"
      aria-label="Podkład mapy"
      className="absolute bottom-8 right-3 z-10 flex flex-col gap-1 rounded-[10px] bg-background p-1.5 text-xs shadow-float"
    >
      {BASE_LAYERS.map((layer) => (
        <button
          key={layer.id}
          type="button"
          aria-pressed={layer.id === value}
          onClick={() => onChange(layer.id)}
          className="rounded-md px-2.5 py-1 text-left aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:bg-accent"
        >
          {layer.label}
        </button>
      ))}
    </div>
  );
}
