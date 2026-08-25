type JsonObject = Record<string, any>;

export type WeightResponseKind = "workout" | "exercise_progress" | "personal_records";

export type WeightContractSummary = {
    canonical_weight_field: "total_weight";
    review_required: boolean;
    ambiguous_weight_entries: number;
    legacy_weight_entries: number;
    note: string;
};

const AMBIGUOUS_VALUES = new Set([
    "ambiguous",
    "legacy_unknown",
    "pending",
    "review_required",
    "unclassified",
    "unknown",
]);

const NON_LOAD_SEMANTICS = new Set([
    "bodyweight",
    "distance",
    "duration",
    "not_applicable",
    "time",
]);

const WEIGHT_VALUE_KEYS = [
    "recorded_weight",
    "total_weight",
    "base_weight",
    "added_weight",
    "weight_semantics",
] as const;

function isObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function normalizedLabel(value: unknown): string | null {
    if (typeof value !== "string") return null;
    return value.trim().toLowerCase().replace(/[ -]+/g, "_");
}

function hasExplicitWeightContract(value: JsonObject): boolean {
    // Aggregate PR records also carry review_status, but are not individual
    // weight rows. Treat that field as row metadata only when the object also
    // has a set-like load value; aggregate suppression is handled separately.
    return WEIGHT_VALUE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
        || (Object.prototype.hasOwnProperty.call(value, "review_status")
            && looksLikeLegacyWeightedSet(value));
}

function looksLikeLegacyWeightedSet(value: JsonObject): boolean {
    if (!isFiniteNumber(value.weight) && !isFiniteNumber(value.actual_weight)) return false;
    return [
        "reps",
        "actual_reps",
        "target_reps",
        "set_number",
        "set_type",
        "rpe",
    ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function explicitlyAmbiguous(value: JsonObject): boolean {
    if (value.review_required === true) return true;

    const semantics = normalizedLabel(value.weight_semantics);
    const reviewStatus = normalizedLabel(value.review_status);
    if (semantics && AMBIGUOUS_VALUES.has(semantics)) return true;
    if (reviewStatus && AMBIGUOUS_VALUES.has(reviewStatus)) return true;

    // Once a response opts into the additive contract, a recorded load with no
    // canonical total is intentionally not reconstructed here. Only Iridium,
    // with the historical review provenance, can decide what that number meant.
    const hasRecordedLoad = isFiniteNumber(value.recorded_weight)
        || isFiniteNumber(value.weight)
        || isFiniteNumber(value.actual_weight);
    return hasRecordedLoad
        && !isFiniteNumber(value.total_weight)
        && !NON_LOAD_SEMANTICS.has(semantics ?? "");
}

function normalizeExplicitWeight(value: JsonObject): boolean {
    const ambiguous = explicitlyAmbiguous(value);
    if (!ambiguous) return false;

    if (!isFiniteNumber(value.recorded_weight)) {
        const legacyRecorded = isFiniteNumber(value.weight) ? value.weight : value.actual_weight;
        if (isFiniteNumber(legacyRecorded)) value.recorded_weight = legacyRecorded;
    }

    // `weight` was the pre-feature compatibility field. Null it on explicitly
    // ambiguous rows so an agent cannot silently use the recorded number as a
    // canonical total. The recorded value remains available for display.
    if (Object.prototype.hasOwnProperty.call(value, "weight")) value.weight = null;
    if (Object.prototype.hasOwnProperty.call(value, "actual_weight")) value.actual_weight = null;
    if (Object.prototype.hasOwnProperty.call(value, "per_implement_weight")) value.per_implement_weight = null;
    value.total_weight = null;
    value.base_weight = null;
    value.added_weight = null;
    value.weight_semantics = "unclassified";
    value.review_status = "review_required";
    value.review_required = true;
    value.weight_interpretation =
        "Recorded weight only. The user must review whether it included the machine's base weight before total, added load, PR, volume, or progression can be inferred.";
    return true;
}

function normalizeLegacyWeight(value: JsonObject): void {
    // The v1 API has always documented `weight` as total load. Keep that
    // fallback for servers predating the additive fields, while labelling the
    // provenance rather than presenting it as a newly reviewed classification.
    const legacyTotal = isFiniteNumber(value.weight) ? value.weight : value.actual_weight;
    value.recorded_weight = legacyTotal;
    value.total_weight = legacyTotal;
    value.base_weight = null;
    value.added_weight = null;
    value.weight_semantics = "legacy_total";
    value.review_status = "legacy_compatible";
    value.weight_interpretation =
        "Legacy Data Sync response: weight is the backward-compatible total-load field; no base/added breakdown was supplied.";
}

function normalizeImplicitAmbiguity(value: JsonObject): void {
    const recorded = isFiniteNumber(value.weight) ? value.weight : value.actual_weight;
    value.recorded_weight = recorded;
    value.weight_semantics = "unclassified";
    value.review_status = "review_required";
    normalizeExplicitWeight(value);
}

function walkWeights(
    value: unknown,
    stats: { ambiguous: number; legacy: number },
    allowLegacyFallback: boolean
): void {
    if (Array.isArray(value)) {
        for (const item of value) walkWeights(item, stats, allowLegacyFallback);
        return;
    }
    if (!isObject(value)) return;

    if (hasExplicitWeightContract(value)) {
        if (normalizeExplicitWeight(value)) stats.ambiguous += 1;
    } else if (looksLikeLegacyWeightedSet(value)) {
        if (allowLegacyFallback) {
            normalizeLegacyWeight(value);
            stats.legacy += 1;
        } else {
            normalizeImplicitAmbiguity(value);
            stats.ambiguous += 1;
        }
    }

    for (const nested of Object.values(value)) {
        if (isObject(nested) || Array.isArray(nested)) walkWeights(nested, stats, allowLegacyFallback);
    }
}

function suppressProgressLoadClaims(data: JsonObject): void {
    const exercise = isObject(data.exercise) ? data.exercise : null;
    if (!exercise) return;

    for (const key of ["estimated_one_rep_max", "estimatedOneRepMax"]) {
        if (Object.prototype.hasOwnProperty.call(exercise, key)) exercise[key] = null;
    }
    for (const key of ["one_rep_max_history", "oneRepMaxHistory", "performance_history", "performanceHistory"]) {
        if (Object.prototype.hasOwnProperty.call(exercise, key)) exercise[key] = [];
    }
    exercise.load_history_review_required = true;
}

function suppressRecordLoadClaims(record: JsonObject): void {
    for (const key of ["bestWeight", "best_weight", "estimated1RM", "estimated_1rm"]) {
        if (Object.prototype.hasOwnProperty.call(record, key)) record[key] = null;
    }
    record.load_records_review_required = true;
}

function suppressPersonalRecordClaims(data: JsonObject, ambiguousEntriesFound: boolean): void {
    const records = Array.isArray(data.records) ? data.records.filter(isObject) : [];
    const responseRequiresReview = data.review_required === true;
    const hasRecordLevelReview = records.some((record) =>
        record.review_required === true
        || Object.prototype.hasOwnProperty.call(record, "review_status")
        || Object.prototype.hasOwnProperty.call(record, "weight_semantics")
    );

    for (const record of records) {
        const recordRequiresReview = record.review_required === true
            || AMBIGUOUS_VALUES.has(normalizedLabel(record.review_status) ?? "")
            || AMBIGUOUS_VALUES.has(normalizedLabel(record.weight_semantics) ?? "");
        if (recordRequiresReview || (responseRequiresReview && !hasRecordLevelReview)) {
            suppressRecordLoadClaims(record);
        }
    }

    // If ambiguity was discovered only in nested set evidence, none of the
    // aggregate records can safely claim to be the user's all-time load PR.
    if (ambiguousEntriesFound && !responseRequiresReview && !hasRecordLevelReview) {
        for (const record of records) suppressRecordLoadClaims(record);
    }
}

function buildSummary(ambiguous: number, legacy: number, serverRequiresReview: boolean): WeightContractSummary {
    const reviewRequired = serverRequiresReview || ambiguous > 0;
    return {
        canonical_weight_field: "total_weight",
        review_required: reviewRequired,
        ambiguous_weight_entries: ambiguous,
        legacy_weight_entries: legacy,
        note: reviewRequired
            ? "Some historical machine weights are ambiguous. Do not infer total load, PRs, volume, or progression from rows marked review_required. Ask the user to finish Base Weight History in Iridium."
            : "Use total_weight for PR, volume, and progression math. base_weight + added_weight describes the same total when those fields are available. recorded_weight is provenance, not necessarily a total.",
    };
}

/**
 * Apply Iridium's additive v1 base-equipment weight contract to a workout or
 * exercise response. This deliberately performs no unit conversion and never
 * tries to guess a total from an ambiguous recorded value.
 */
export function prepareWeightResponse<T>(input: T, kind: WeightResponseKind): T {
    if (!isObject(input)) return input;

    // API JSON is mutable and newly allocated for each tool call. Clone here
    // anyway so tests/callers never observe surprising mutations of fixtures.
    const data = structuredClone(input) as JsonObject;
    const stats = { ambiguous: 0, legacy: 0 };
    const serverRequiresReview = data.review_required === true;
    walkWeights(data, stats, !serverRequiresReview);

    const reviewRequired = serverRequiresReview || stats.ambiguous > 0;
    if (reviewRequired && kind === "exercise_progress") suppressProgressLoadClaims(data);
    if (kind === "personal_records") suppressPersonalRecordClaims(data, stats.ambiguous > 0);

    data.review_required = reviewRequired;
    data._weight_guidance = buildSummary(stats.ambiguous, stats.legacy, serverRequiresReview);
    return data as T;
}
