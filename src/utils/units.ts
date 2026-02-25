/**
 * Unit conversion utilities.
 * iOS app always stores weights in kilograms internally.
 * MCP server converts to user's preferred unit system.
 */

const KG_TO_LBS = 2.20462;

/**
 * Convert kilograms to pounds, rounded to 1 decimal place.
 */
export function kgToLbs(kg: number): number {
    return Math.round(kg * KG_TO_LBS * 10) / 10;
}

/**
 * Weight field names that should be converted.
 */
const WEIGHT_FIELDS = new Set([
    "weight",
    "max_weight",
    "maxWeight",
    "targetWeight",
    "target_weight",
]);

/**
 * Recursively convert all weight-related fields from kg to lbs in an object.
 * Handles nested objects and arrays.
 * 
 * @param data - The data to convert
 * @param convertToLbs - If true, convert kg to lbs. If false, leave as kg.
 */
export function convertWeights<T>(data: T, convertToLbs: boolean): T {
    if (data === null || data === undefined) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map((item) => convertWeights(item, convertToLbs)) as T;
    }

    if (typeof data === "object") {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(data as Record<string, any>)) {
            // Update the _units field to reflect actual units
            if (key === "_units" && typeof value === "object" && value !== null) {
                result[key] = {
                    ...value,
                    weight: convertToLbs ? "lbs" : "kg",
                };
            }
            // Convert weight fields if imperial
            else if (typeof value === "number" && WEIGHT_FIELDS.has(key)) {
                result[key] = convertToLbs ? kgToLbs(value) : value;
            } else {
                result[key] = convertWeights(value, convertToLbs);
            }
        }
        return result as T;
    }

    return data;
}
