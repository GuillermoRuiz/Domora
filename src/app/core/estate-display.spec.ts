import { formatEstateAddress, normalizeEstateSearch } from "./estate-display";

describe("estate display helpers", () => {
  it("añade el número y no lo duplica si ya está en la dirección", () => {
    expect(
      formatEstateAddress({
        address: "Calle Mayor",
        streetNumber: "12",
        location: "Madrid",
      }),
    ).toBe("Calle Mayor 12, Madrid");
    expect(
      formatEstateAddress({
        address: "Calle Mayor 12",
        streetNumber: "12",
        location: "Madrid",
      }),
    ).toBe("Calle Mayor 12, Madrid");
    expect(
      formatEstateAddress({
        address: "Calle 120",
        streetNumber: "12",
        location: "",
      }),
    ).toBe("Calle 120 12");
    expect(
      formatEstateAddress({
        address: "Calle Mayor 12-14",
        streetNumber: "12",
        location: "",
      }),
    ).toBe("Calle Mayor 12-14");
  });
  it("normaliza tildes y mayúsculas", () =>
    expect(normalizeEstateSearch(" PÍNOS ")).toBe("pinos"));
});
