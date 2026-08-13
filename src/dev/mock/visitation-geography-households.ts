import type { Feature, FeatureCollection, Point } from "geojson";

type MockHouseholdProperties = {
  householdId: string;
  householdName: string;
  memberCount: number;
  visited: boolean;
  visitCount: number;
};

const createHouseholdFeature = (
  householdId: string,
  householdName: string,
  coordinates: [number, number],
  memberCount: number,
  visited: boolean,
  visitCount: number,
): Feature<Point, MockHouseholdProperties> => ({
  type: "Feature",
  id: householdId,
  geometry: {
    type: "Point",
    coordinates,
  },
  properties: {
    householdId,
    householdName,
    memberCount,
    visited,
    visitCount,
  },
});

export const mockVisitationGeographyHouseholds: FeatureCollection<Point, MockHouseholdProperties> = {
  type: "FeatureCollection",
  features: [
    createHouseholdFeature("kanata-01", "Beaverbrook Household", [-75.902, 45.316], 3, true, 2),
    createHouseholdFeature("kanata-02", "Katimavik Household", [-75.919, 45.301], 4, false, 0),
    createHouseholdFeature("kanata-03", "Bridlewood Household", [-75.876, 45.287], 5, true, 4),
    createHouseholdFeature("kanata-04", "Kanata Lakes Household", [-75.934, 45.33], 2, true, 1),
    createHouseholdFeature("kanata-05", "Morgan's Grant Household", [-75.889, 45.348], 6, false, 0),
    createHouseholdFeature("kanata-06", "Hazeldean Household", [-75.857, 45.296], 3, true, 3),

    createHouseholdFeature("barrhaven-01", "Longfields Household", [-75.737, 45.269], 4, false, 0),
    createHouseholdFeature("barrhaven-02", "Chapman Mills Household", [-75.749, 45.274], 5, true, 2),
    createHouseholdFeature("barrhaven-03", "Half Moon Bay Household", [-75.766, 45.252], 3, false, 0),
    createHouseholdFeature("barrhaven-04", "Stonebridge Household", [-75.751, 45.246], 2, true, 1),
    createHouseholdFeature("barrhaven-05", "Cedarhill Household", [-75.779, 45.289], 6, true, 5),
    createHouseholdFeature("barrhaven-06", "Fallowfield Household", [-75.72, 45.289], 4, false, 0),

    createHouseholdFeature("nepean-01", "Centrepointe Household", [-75.759, 45.351], 2, true, 1),
    createHouseholdFeature("nepean-02", "Craig Henry Household", [-75.766, 45.338], 5, true, 3),
    createHouseholdFeature("nepean-03", "Trend-Arlington Household", [-75.771, 45.326], 4, false, 0),
    createHouseholdFeature("nepean-04", "Bells Corners Household", [-75.83, 45.315], 3, true, 2),
    createHouseholdFeature("nepean-05", "Merivale Household", [-75.737, 45.345], 6, false, 0),
    createHouseholdFeature("nepean-06", "Tanglewood Household", [-75.739, 45.329], 3, true, 4),

    createHouseholdFeature("central-01", "Hintonburg Household", [-75.732, 45.404], 2, true, 2),
    createHouseholdFeature("central-02", "Westboro Household", [-75.754, 45.393], 4, false, 0),
    createHouseholdFeature("central-03", "Centretown Household", [-75.696, 45.414], 1, true, 1),
    createHouseholdFeature("central-04", "The Glebe Household", [-75.695, 45.401], 5, true, 4),
    createHouseholdFeature("central-05", "Sandy Hill Household", [-75.674, 45.424], 3, false, 0),
    createHouseholdFeature("central-06", "Lowertown Household", [-75.684, 45.431], 4, true, 2),

    createHouseholdFeature("orleans-01", "Fallingbrook Household", [-75.488, 45.478], 3, true, 1),
    createHouseholdFeature("orleans-02", "Queenswood Heights Household", [-75.506, 45.468], 4, false, 0),
    createHouseholdFeature("orleans-03", "Convent Glen Household", [-75.545, 45.462], 2, true, 3),
    createHouseholdFeature("orleans-04", "Chapel Hill Household", [-75.564, 45.451], 5, true, 2),
    createHouseholdFeature("orleans-05", "Avalon Household", [-75.474, 45.445], 6, false, 0),
    createHouseholdFeature("orleans-06", "Cardinal Creek Household", [-75.434, 45.489], 4, true, 5),

    createHouseholdFeature("gloucester-01", "Beacon Hill Household", [-75.643, 45.443], 2, true, 2),
    createHouseholdFeature("gloucester-02", "Blackburn Hamlet Household", [-75.567, 45.432], 5, false, 0),
    createHouseholdFeature("gloucester-03", "Riverview Household", [-75.651, 45.386], 4, true, 1),
    createHouseholdFeature("gloucester-04", "Carson Grove Household", [-75.633, 45.431], 3, false, 0),
    createHouseholdFeature("gloucester-05", "Pineview Household", [-75.612, 45.417], 6, true, 4),
    createHouseholdFeature("gloucester-06", "Hunt Club East Household", [-75.611, 45.363], 2, true, 1),

    createHouseholdFeature("gatineau-01", "Hull Waterfront Household", [-75.726, 45.431], 3, true, 2),
    createHouseholdFeature("gatineau-02", "Aylmer Household", [-75.86, 45.399], 4, false, 0),
    createHouseholdFeature("gatineau-03", "Plateau Household", [-75.79, 45.435], 5, true, 3),
    createHouseholdFeature("gatineau-04", "Manoir des Trembles Household", [-75.774, 45.465], 2, false, 0),
    createHouseholdFeature("gatineau-05", "Gatineau North Household", [-75.696, 45.492], 6, true, 4),
    createHouseholdFeature("gatineau-06", "Lac-des-Fées Household", [-75.758, 45.444], 3, true, 1),
  ],
};

export type { MockHouseholdProperties };
