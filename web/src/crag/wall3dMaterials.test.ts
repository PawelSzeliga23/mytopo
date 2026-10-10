import { describe, expect, it } from "vitest";
import { createHologramMaterial, GROUND_COLOR, ROCK_COLOR } from "./wall3dMaterials";

describe("createHologramMaterial", () => {
  it("uses the wall's colours, or the default ones", () => {
    const custom = createHologramMaterial("#112233", null);
    expect(`#${custom.uniforms.rock.value.getHexString()}`).toBe("#112233");
    expect(`#${custom.uniforms.ground.value.getHexString()}`).toBe(GROUND_COLOR);
    expect(`#${createHologramMaterial().uniforms.rock.value.getHexString()}`).toBe(ROCK_COLOR);
  });
});
