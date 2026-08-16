import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAddress } from "../shared/address-normalization.js";

test("normalizes equivalent street formats to the same address key", () => {
  const first = normalizeAddress({ address: "123 Main Street, Ottawa", postalCode: "K1A 0B1" });
  const second = normalizeAddress({ address: "123 MAIN ST. Ottawa", postalCode: "k1a-0b1" });

  assert.equal(first.normalizedAddress, "123 MAIN ST OTTAWA");
  assert.equal(second.normalizedAddress, "123 MAIN ST OTTAWA");
  assert.equal(first.normalizedPostalCode, "K1A0B1");
  assert.equal(second.normalizedPostalCode, "K1A0B1");
  assert.equal(first.addressKey, second.addressKey);
});

test("keeps units as part of household identity", () => {
  const apartment = normalizeAddress({ address: "100 Main St Apt 201", postalCode: "K1A 0B1" });
  const hashUnit = normalizeAddress({ address: "#201 100 Main St", postalCode: "K1A0B1" });
  const otherUnit = normalizeAddress({ address: "202-100 Main St", postalCode: "K1A0B1" });

  assert.equal(apartment.unit, "201");
  assert.equal(hashUnit.unit, "201");
  assert.equal(apartment.addressKey, hashUnit.addressKey);
  assert.notEqual(apartment.addressKey, otherUnit.addressKey);
});

test("preserves accented French characters in normalized addresses", () => {
  const normalized = normalizeAddress({
    address: "123 rue d'Orléans, Québec",
    postalCode: "G1A 0A2",
  });

  assert.equal(normalized.normalizedAddress, "123 RUE DORLÉANS QUÉBEC");
  assert.equal(normalized.addressKey, "123 RUE DORLÉANS QUÉBEC|G1A0A2");
});
