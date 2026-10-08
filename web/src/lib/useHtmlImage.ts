import { useEffect, useState } from "react";

export type ImageStatus = "loading" | "loaded" | "failed";

interface Loaded {
  url: string;
  image: HTMLImageElement | null;
  status: ImageStatus;
}

export function useHtmlImage(url: string | null): { image: HTMLImageElement | null; status: ImageStatus } {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    if (!url) return;
    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (active) setLoaded({ url, image, status: "loaded" });
    };
    image.onerror = () => {
      if (active) setLoaded({ url, image: null, status: "failed" });
    };
    image.src = url;
    return () => {
      active = false;
    };
  }, [url]);
  if (!url) return { image: null, status: "failed" };
  return loaded?.url === url ? { image: loaded.image, status: loaded.status } : { image: null, status: "loading" };
}
