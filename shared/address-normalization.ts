const unitPrefixPattern = /\b(?:unit|apt|apartment|suite|ste)\s*([a-z0-9-]+)\b/i;
const leadingUnitPattern = /^([a-z0-9]+)\s*-\s*(\d[\w\s.'#,-]*)$/i;
const nonLetterOrNumberPattern = /[^\p{L}\p{N}]/gu;
const canadianPostalCodePattern = /\b([ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ][ -]?\d[ABCEGHJKLMNPRSTVWXYZ]\d)\b/i;

const directionalMap: Record<string, string> = {
  north: "N",
  south: "S",
  east: "E",
  west: "W",
  n: "N",
  s: "S",
  e: "E",
  w: "W",
};

const streetTypeMap: Record<string, string> = {
  street: "ST",
  st: "ST",
  road: "RD",
  rd: "RD",
  avenue: "AVE",
  ave: "AVE",
  boulevard: "BLVD",
  blvd: "BLVD",
  drive: "DR",
  dr: "DR",
  lane: "LN",
  ln: "LN",
  court: "CT",
  ct: "CT",
  crescent: "CRES",
  cres: "CRES",
  place: "PL",
  pl: "PL",
  highway: "HWY",
  hwy: "HWY",
};

export type NormalizedAddress = {
  originalAddress?: string;
  normalizedAddress?: string;
  normalizedPostalCode?: string;
  unit?: string;
  addressKey?: string;
};

const normalizeWhitespace = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const cleanPostalCode = (postalCode: unknown) => {
  const normalized = normalizeWhitespace(postalCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(normalized) ? normalized : normalized || undefined;
};

/**
 * Splits the postal code out of an address exported as one combined field.
 * Unity exports commonly put the Canadian postal code in `Address` rather
 * than providing the separate `Postal Code` column the importer supports.
 */
export const extractCanadianPostalCodeFromAddress = (value: unknown) => {
  const originalAddress = normalizeWhitespace(value);
  const match = originalAddress.match(canadianPostalCodePattern);
  if (!match || match.index === undefined) {
    return {
      address: originalAddress || undefined,
      postalCode: undefined,
    };
  }

  const address = normalizeWhitespace(
    `${originalAddress.slice(0, match.index)} ${originalAddress.slice(match.index + match[0].length)}`,
  )
    .replace(/,\s*,+/g, ",")
    .replace(/,\s*$/, "")
    .trim();

  return {
    address: address || undefined,
    postalCode: cleanPostalCode(match[1]),
  };
};

const canonicalizeAddressTokens = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      const cleaned = token.replace(nonLetterOrNumberPattern, "");
      const streetType = streetTypeMap[cleaned.toLowerCase()];
      if (streetType) {
        return streetType;
      }

      const direction = directionalMap[cleaned.toLowerCase()];
      if (direction) {
        return direction;
      }

      return cleaned;
    })
    .filter(Boolean);

const extractUnit = (address: string) => {
  const explicitUnit = address.match(unitPrefixPattern);
  if (explicitUnit) {
    const [, rawUnit] = explicitUnit;
    const unit = rawUnit?.replace(nonLetterOrNumberPattern, "").toUpperCase();
    const remainder = address.replace(explicitUnit[0], " ");
    return { remainder, unit: unit || undefined };
  }

  const hashUnit = address.match(/#\s*([a-z0-9-]+)/i);
  if (hashUnit) {
    const [, rawUnit] = hashUnit;
    const unit = rawUnit?.replace(nonLetterOrNumberPattern, "").toUpperCase();
    const remainder = address.replace(hashUnit[0], " ");
    return { remainder, unit: unit || undefined };
  }

  const leadingUnit = address.match(leadingUnitPattern);
  if (leadingUnit) {
    const [, rawUnit, remainder] = leadingUnit;
    const unit = rawUnit?.replace(nonLetterOrNumberPattern, "").toUpperCase();
    return { remainder, unit: unit || undefined };
  }

  return { remainder: address, unit: undefined };
};

export const buildAddressBasedHouseholdName = (address: string | undefined) => {
  const normalized = normalizeWhitespace(address);
  return normalized ? `${normalized} Household` : "Household";
};

export const normalizeAddress = ({
  address,
  postalCode,
}: {
  address?: string;
  postalCode?: string;
}): NormalizedAddress => {
  const originalAddress = normalizeWhitespace(address) || undefined;
  const normalizedPostalCode = cleanPostalCode(postalCode);

  if (!originalAddress) {
    return {
      originalAddress,
      normalizedPostalCode,
    };
  }

  const uppercaseAddress = originalAddress.toUpperCase().replace(/[.,]/g, " ");
  const { remainder, unit } = extractUnit(uppercaseAddress);
  const normalizedAddress = canonicalizeAddressTokens(remainder).join(" ") || undefined;

  const keyParts = [normalizedAddress, normalizedPostalCode, unit].filter(Boolean);

  return {
    originalAddress,
    normalizedAddress,
    normalizedPostalCode,
    unit,
    addressKey: keyParts.length >= 2 ? keyParts.join("|") : undefined,
  };
};
