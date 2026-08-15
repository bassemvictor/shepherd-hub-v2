import assert from "node:assert/strict";
import test from "node:test";

import {
  UNASSIGNED_AREA_ID,
  classifyVisitationAreaFromPostalCode,
  getFsaFromPostalCode,
  getVisitationAreaDefinition,
  resolveVisitationAreaId,
} from "../shared/visitation-areas.js";

test("extracts Canadian FSAs from normalized postal codes", () => {
  assert.equal(getFsaFromPostalCode("k2p 1l4"), "K2P");
  assert.equal(getFsaFromPostalCode(" J8Y-4A2 "), "J8Y");
  assert.equal(getFsaFromPostalCode(""), undefined);
});

test("classifies configured FSAs into application-defined visitation areas", () => {
  assert.equal(classifyVisitationAreaFromPostalCode("K2P 1L4"), "CENTRAL");
  assert.equal(classifyVisitationAreaFromPostalCode("K2J 0A1"), "BARRHAVEN");
  assert.equal(classifyVisitationAreaFromPostalCode("J8Y 4A2"), "GATINEAU");
});

test("returns UNASSIGNED for unknown postal codes and normalizes legacy aliases", () => {
  assert.equal(classifyVisitationAreaFromPostalCode("K1A 0B1"), UNASSIGNED_AREA_ID);
  assert.equal(resolveVisitationAreaId({ areaId: "area-central" }), "CENTRAL");
  assert.equal(resolveVisitationAreaId({ areaId: "not-a-real-area", postalCode: "K1A 0B1" }), UNASSIGNED_AREA_ID);
  assert.equal(getVisitationAreaDefinition("UNASSIGNED").label, "Other / Unassigned");
});
