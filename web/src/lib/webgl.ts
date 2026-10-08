let cached: boolean | null = null;

/** Whether the browser can draw WebGL (checked once; old devices and disabled acceleration get the 2D viewer). */
export function hasWebGL(): boolean {
  if (cached === null) {
    try {
      const canvas = document.createElement("canvas");
      cached = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      cached = false;
    }
  }
  return cached;
}
