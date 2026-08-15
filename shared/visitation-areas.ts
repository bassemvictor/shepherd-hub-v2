const normalizeWhitespace = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

export const UNASSIGNED_AREA_ID = "UNASSIGNED" as const;

export const visitationAreaDefinitions = [
  {
    id: "KANATA",
    label: "Kanata",
    fsaPrefixes: ["K2K", "K2L", "K2M", "K2T"],
  },
  {
    id: "NEPEAN",
    label: "Nepean",
    fsaPrefixes: ["K2E", "K2G", "K2H"],
  },
  {
    id: "BARRHAVEN",
    label: "Barrhaven",
    fsaPrefixes: ["K2J"],
  },
  {
    id: "ORLEANS",
    label: "Orleans",
    fsaPrefixes: ["K1C", "K1E", "K1W", "K4A"],
  },
  {
    id: "CENTRAL",
    label: "Central",
    fsaPrefixes: ["K1N", "K1P", "K1R", "K1S", "K2P"],
  },
  {
    id: "GLOUCESTER",
    label: "Gloucester",
    fsaPrefixes: ["K1B", "K1G", "K1J"],
  },
  {
    id: "SOUTH_OTTAWA",
    label: "South Ottawa",
    fsaPrefixes: ["K1T", "K1V", "K1X", "K4M"],
  },
  {
    id: "GATINEAU",
    label: "Gatineau",
    fsaPrefixes: ["J8L", "J8M", "J8P", "J8R", "J8T", "J8V", "J8X", "J8Y", "J8Z", "J9A", "J9H", "J9J"],
  },
  {
    id: UNASSIGNED_AREA_ID,
    label: "Other / Unassigned",
    fsaPrefixes: [],
  },
] as const;

export type VisitationAreaDefinition = typeof visitationAreaDefinitions[number];
export type VisitationAreaId = VisitationAreaDefinition["id"];

const areaDefinitionById = new Map<VisitationAreaId, VisitationAreaDefinition>(
  visitationAreaDefinitions.map((definition) => [definition.id, definition]),
);

const areaIdAliases: Record<string, VisitationAreaId> = {
  "AREA-KANATA": "KANATA",
  "AREA-NEPEAN": "NEPEAN",
  "AREA-BARRHAVEN": "BARRHAVEN",
  "AREA-ORLEANS": "ORLEANS",
  "AREA-CENTRAL": "CENTRAL",
  "AREA-GLOUCESTER": "GLOUCESTER",
  "AREA-SOUTH-OTTAWA": "SOUTH_OTTAWA",
  "AREA-GATINEAU": "GATINEAU",
  "AREA-OTHER": UNASSIGNED_AREA_ID,
  "AREA-UNASSIGNED": UNASSIGNED_AREA_ID,
};

const normalizeAreaId = (value: unknown) => {
  const normalized = normalizeWhitespace(value).toUpperCase();
  return areaIdAliases[normalized] ?? normalized;
};

export const isVisitationAreaId = (value: unknown): value is VisitationAreaId =>
  areaDefinitionById.has(normalizeAreaId(value) as VisitationAreaId);

export const getVisitationAreaDefinition = (areaId: string | undefined | null) =>
  areaDefinitionById.get(normalizeAreaId(areaId) as VisitationAreaId)
  ?? areaDefinitionById.get(UNASSIGNED_AREA_ID)!;

export const normalizeCanadianPostalCode = (postalCode: string | undefined | null) => {
  const normalized = normalizeWhitespace(postalCode).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || undefined;
};

export const getFsaFromPostalCode = (postalCode: string | undefined | null) => {
  const normalized = normalizeCanadianPostalCode(postalCode);
  return normalized && normalized.length >= 3 ? normalized.slice(0, 3) : undefined;
};

export const classifyVisitationAreaFromPostalCode = (
  postalCode: string | undefined | null,
): VisitationAreaId => {
  const fsa = getFsaFromPostalCode(postalCode);
  if (!fsa) {
    return UNASSIGNED_AREA_ID;
  }

  const matches: VisitationAreaId[] = [];
  for (const definition of visitationAreaDefinitions) {
    if (definition.id === UNASSIGNED_AREA_ID) {
      continue;
    }

    if ((definition.fsaPrefixes as readonly string[]).includes(fsa)) {
      matches.push(definition.id);
    }
  }

  return matches.length === 1 ? matches[0] : UNASSIGNED_AREA_ID;
};

export const resolveVisitationAreaId = ({
  areaId,
  postalCode,
}: {
  areaId?: string | null;
  postalCode?: string | null;
}): VisitationAreaId => {
  const normalizedAreaId = normalizeAreaId(areaId);
  if (isVisitationAreaId(normalizedAreaId)) {
    return normalizedAreaId;
  }

  return classifyVisitationAreaFromPostalCode(postalCode);
};
