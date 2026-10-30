export function normalizeEstateSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .trim();
}

export function formatEstateAddress(estate: {
  address: string;
  streetNumber?: string | null;
  location: string;
}): string {
  const address = estate.address.trim();
  const number = estate.streetNumber?.trim() ?? "";
  const numberAlreadyPresent =
    number &&
    new RegExp(
      `(?:^|[\\s,])${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s,.;/\\-])`,
      "i",
    ).test(address);
  return [
    [address, number && !numberAlreadyPresent ? number : ""]
      .filter(Boolean)
      .join(" "),
    estate.location.trim(),
  ]
    .filter(Boolean)
    .join(", ");
}
