import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useMapData() {
  const regions = useQuery({ queryKey: ["map", "regions"], queryFn: api.regions });
  const sectors = useQuery({ queryKey: ["map", "sectors"], queryFn: api.sectorHulls });
  const crags = useQuery({ queryKey: ["map", "crags"], queryFn: api.crags });
  return {
    regions: regions.data,
    sectors: sectors.data,
    crags: crags.data,
    error: regions.error ?? sectors.error ?? crags.error ?? null,
  };
}
