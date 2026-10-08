import { describe, expect, it } from "vitest";
import { formatViewHash, parseViewHash } from "@/map/view";

describe("widok mapy w adresie", () => {
  it("zapis i odczyt", () => {
    const hash = formatViewHash({ longitude: 19.764721, latitude: 50.166141, zoom: 13.256 });
    expect(hash).toBe("#13.26/50.16614/19.76472");
    expect(parseViewHash(hash)).toEqual({ longitude: 19.76472, latitude: 50.16614, zoom: 13.26 });
  });

  it.each(["", "#", "#abc", "#13/50", "#13/50/19/1", "#13//19", "#30/50/19", "#13/95/19", "#13/50/200", "#x/50/19"])(
    "zły fragment adresu %s → brak widoku",
    (hash) => {
      expect(parseViewHash(hash)).toBeNull();
    },
  );
});
