import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../build/api-client.js";
import { prepareWeightResponse } from "../build/utils/weight-contract.js";

test("reviewed machine sets expose canonical total, base, and added load", () => {
    const result = prepareWeightResponse({
        recentSets: [{
            weight: 135,
            recorded_weight: 90,
            total_weight: 135,
            base_weight: 45,
            added_weight: 90,
            weight_semantics: "added",
            review_status: "reviewed",
            reps: 8,
        }],
    }, "exercise_progress");

    const set = result.recentSets[0];
    assert.equal(set.recorded_weight, 90);
    assert.equal(set.total_weight, 135);
    assert.equal(set.base_weight, 45);
    assert.equal(set.added_weight, 90);
    assert.equal(result.review_required, false);
    assert.equal(result._weight_guidance.canonical_weight_field, "total_weight");
});

test("ambiguous rows preserve recorded history but suppress canonical load", () => {
    const result = prepareWeightResponse({
        workouts: [{
            exercise_sets: [{
                sets: [{
                    weight: 90,
                    actual_weight: 90,
                    per_implement_weight: 45,
                    recorded_weight: 90,
                    total_weight: null,
                    base_weight: 45,
                    added_weight: null,
                    weight_semantics: "unclassified",
                    review_status: "pending",
                    reps: 8,
                }],
            }],
        }],
    }, "workout");

    const set = result.workouts[0].exercise_sets[0].sets[0];
    assert.equal(set.recorded_weight, 90);
    assert.equal(set.weight, null);
    assert.equal(set.actual_weight, null);
    assert.equal(set.per_implement_weight, null);
    assert.equal(set.total_weight, null);
    assert.equal(set.base_weight, null);
    assert.equal(set.added_weight, null);
    assert.equal(set.review_status, "review_required");
    assert.equal(result.review_required, true);
    assert.equal(result._weight_guidance.ambiguous_weight_entries, 1);
    assert.match(set.weight_interpretation, /must review/i);
});

test("legacy actual_weight-only sets retain the total-load fallback", () => {
    const result = prepareWeightResponse({
        recentSets: [{ actual_weight: 80, actual_reps: 10 }],
    }, "exercise_progress");

    const set = result.recentSets[0];
    assert.equal(set.actual_weight, 80);
    assert.equal(set.recorded_weight, 80);
    assert.equal(set.total_weight, 80);
    assert.equal(set.weight_semantics, "legacy_total");
});

test("top-level review_required prevents legacy fields from being assumed total", () => {
    const result = prepareWeightResponse({
        review_required: true,
        recentSets: [{ weight: 80, reps: 10 }],
    }, "exercise_progress");

    const set = result.recentSets[0];
    assert.equal(set.recorded_weight, 80);
    assert.equal(set.weight, null);
    assert.equal(set.total_weight, null);
    assert.equal(set.review_status, "review_required");
    assert.equal(result._weight_guidance.legacy_weight_entries, 0);
});

test("an incomplete additive row fails closed instead of falling back to weight", () => {
    const result = prepareWeightResponse({
        recentSets: [{
            weight: 80,
            weight_semantics: "added",
            review_status: "reviewed",
            reps: 10,
        }],
    }, "exercise_progress");

    const set = result.recentSets[0];
    assert.equal(set.recorded_weight, 80);
    assert.equal(set.weight, null);
    assert.equal(set.total_weight, null);
    assert.equal(set.review_status, "review_required");
});

test("legacy v1 set weights retain the documented total-load fallback", () => {
    const result = prepareWeightResponse({
        workouts: [{ exercise_sets: [{ sets: [{ weight: 100, reps: 5 }] }] }],
    }, "workout");

    const set = result.workouts[0].exercise_sets[0].sets[0];
    assert.equal(set.weight, 100);
    assert.equal(set.recorded_weight, 100);
    assert.equal(set.total_weight, 100);
    assert.equal(set.weight_semantics, "legacy_total");
    assert.equal(set.review_status, "legacy_compatible");
    assert.equal(result.review_required, false);
    assert.equal(result._weight_guidance.legacy_weight_entries, 1);
});

test("non-set weight-shaped data is not relabelled as a training load", () => {
    const result = prepareWeightResponse({ profile: { weight: 180 } }, "workout");
    assert.deepEqual(result.profile, { weight: 180 });
    assert.equal(result._weight_guidance.legacy_weight_entries, 0);
});

test("ambiguous exercise progress suppresses cached 1RM and performance claims", () => {
    const result = prepareWeightResponse({
        exercise: {
            estimated_one_rep_max: 200,
            one_rep_max_history: [{ value: 190 }],
            performance_history: [{ weight: 180 }],
        },
        recentSets: [{
            recorded_weight: 180,
            weight_semantics: "unknown",
            review_status: "review_required",
            reps: 8,
        }],
    }, "exercise_progress");

    assert.equal(result.review_required, true);
    assert.equal(result.exercise.estimated_one_rep_max, null);
    assert.deepEqual(result.exercise.one_rep_max_history, []);
    assert.deepEqual(result.exercise.performance_history, []);
    assert.equal(result.exercise.load_history_review_required, true);
});

test("personal records suppress load claims but keep rep-only records", () => {
    const result = prepareWeightResponse({
        review_required: true,
        records: [{
            exerciseName: "Leg Press",
            bestWeight: { value: 500, date: "2026-08-01" },
            bestReps: { value: 20, date: "2026-08-01" },
            estimated1RM: { value: 600, date: "2026-08-01" },
        }],
    }, "personal_records");

    assert.equal(result.records[0].bestWeight, null);
    assert.equal(result.records[0].estimated1RM, null);
    assert.deepEqual(result.records[0].bestReps, { value: 20, date: "2026-08-01" });
    assert.equal(result.records[0].load_records_review_required, true);
});

test("record-level review status suppresses only the affected PR", () => {
    const result = prepareWeightResponse({
        records: [
            {
                exerciseName: "Leg Press",
                bestWeight: { value: 500 },
                estimated1RM: { value: 600 },
                review_required: true,
            },
            {
                exerciseName: "Bench Press",
                bestWeight: { value: 225 },
                estimated1RM: { value: 250 },
                review_status: "reviewed",
            },
        ],
    }, "personal_records");

    assert.equal(result.records[0].bestWeight, null);
    assert.deepEqual(result.records[1].bestWeight, { value: 225 });
});

test("record-level review_status suppresses only the affected PR", () => {
    const result = prepareWeightResponse({
        records: [
            {
                exerciseName: "Leg Press",
                bestWeight: { value: 500 },
                estimated1RM: { value: 600 },
                review_status: "review_required",
            },
            {
                exerciseName: "Bench Press",
                bestWeight: { value: 225 },
                estimated1RM: { value: 250 },
                review_status: "reviewed",
            },
        ],
    }, "personal_records");

    assert.equal(result.records[0].bestWeight, null);
    assert.deepEqual(result.records[1].bestWeight, { value: 225 });
});

test("top-level review_required respects record-level review metadata", () => {
    const result = prepareWeightResponse({
        review_required: true,
        records: [
            {
                exerciseName: "Leg Press",
                bestWeight: { value: 500 },
                estimated1RM: { value: 600 },
                review_status: "review_required",
            },
            {
                exerciseName: "Bench Press",
                bestWeight: { value: 225 },
                estimated1RM: { value: 250 },
                review_status: "reviewed",
            },
        ],
    }, "personal_records");

    assert.equal(result.records[0].bestWeight, null);
    assert.deepEqual(result.records[1].bestWeight, { value: 225 });
});

test("ApiClient uses additive v1 without a contract-version header", async () => {
    const originalFetch = globalThis.fetch;
    let headers: HeadersInit | undefined;
    globalThis.fetch = async (_input, init) => {
        headers = init?.headers;
        return new Response(JSON.stringify({ workouts: [], lastSyncAt: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        await new ApiClient("sync-id", "sync-key").get("/api/v1/data/workouts");
    } finally {
        globalThis.fetch = originalFetch;
    }

    const normalized = new Headers(headers);
    assert.equal(normalized.get("x-sync-id"), "sync-id");
    assert.equal(normalized.get("x-sync-key"), "sync-key");
    assert.equal(normalized.has("x-iridium-weight-contract"), false);
});
