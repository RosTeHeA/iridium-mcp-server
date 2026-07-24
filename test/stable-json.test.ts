import { test } from "node:test";
import assert from "node:assert/strict";
import { stableStringify } from "../build/utils/stable-json.js";

test("key order does not affect the output", () => {
    const a = { name: "Burger", calories: 700, protein: 35 };
    const b = { protein: 35, name: "Burger", calories: 700 };
    assert.equal(stableStringify(a), stableStringify(b));
});

test("nested objects are sorted too", () => {
    const a = { outer: { z: 1, a: 2 }, first: true };
    const b = { first: true, outer: { a: 2, z: 1 } };
    assert.equal(stableStringify(a), stableStringify(b));
});

test("undefined values are dropped, so omitted and explicit-undefined agree", () => {
    assert.equal(
        stableStringify({ name: "Burger", brand: undefined }),
        stableStringify({ name: "Burger" })
    );
});

test("null is preserved and is distinct from undefined", () => {
    assert.notEqual(
        stableStringify({ name: "Burger", brand: null }),
        stableStringify({ name: "Burger" })
    );
});

test("array order is preserved (it is meaningful)", () => {
    assert.notEqual(stableStringify({ xs: [1, 2] }), stableStringify({ xs: [2, 1] }));
});

/**
 * The reason the idempotency hash covers the whole payload rather than a
 * hand-picked subset: two calls that differ only in a micronutrient are
 * different entries, and hashing a subset made the second one a silent no-op.
 */
test("a differing micronutrient changes the hash", () => {
    const base = { name: "Burger", calories: 700, protein: 35, carbs: 45, fat: 40 };
    assert.notEqual(
        stableStringify({ ...base, fiber: 3 }),
        stableStringify({ ...base, fiber: 4 })
    );
    assert.notEqual(stableStringify({ ...base, sodium: 900 }), stableStringify(base));
});

test("identical payloads still dedupe", () => {
    const payload = {
        name: "Burger",
        calories: 700,
        date: "2026-04-29T12:00:00-06:00",
        fiber: 3,
    };
    assert.equal(stableStringify(payload), stableStringify({ ...payload }));
});
