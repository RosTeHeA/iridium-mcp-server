import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../build/api-client.js";
import { readTool } from "../build/tools/shared.js";

function apiReturning(payload: Record<string, unknown>): ApiClient {
    const api = new ApiClient("sync-id", "sync-key");
    api.get = async () => ({ ...payload, lastSyncAt: null }) as never;
    api.formatStalenessWarning = () => "";
    return api;
}

test("read tools return additive base-equipment weight fields unchanged", async () => {
    const set = {
        weight: 100,
        recorded_weight: 60,
        total_weight: 100,
        base_weight: 40,
        added_weight: 60,
        review_status: "classified",
    };
    const result = await readTool(
        apiReturning({ workouts: [{ exercise_sets: [{ sets: [set] }] }] }),
        "workouts",
        "/api/v1/data/workouts"
    );
    const decoded = JSON.parse(result.content[0].text);

    assert.deepEqual(decoded.workouts[0].exercise_sets[0].sets[0], set);
});

test("read tools remain compatible with legacy weight-only payloads", async () => {
    const legacySet = { weight: 100, reps: 8 };
    const result = await readTool(
        apiReturning({ workouts: [{ exercise_sets: [{ sets: [legacySet] }] }] }),
        "workouts",
        "/api/v1/data/workouts"
    );
    const decoded = JSON.parse(result.content[0].text);

    assert.deepEqual(decoded.workouts[0].exercise_sets[0].sets[0], legacySet);
});
