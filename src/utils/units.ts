/**
 * Unit conversion utilities.
 * iOS app always stores weights in kilograms internally.
 * MCP server converts to pounds for display (imperial system).
 */

const KG_TO_LBS = 2.20462;

/**
 * Convert kilograms to pounds, rounded to 1 decimal place.
 */
export function kgToLbs(kg: number): number {
    return Math.round(kg * KG_TO_LBS * 10) / 10;
}

/**
 * Recursively convert all weight-related fields from kg to lbs in an object.
 * Handles nested objects and arrays.
 */
export function convertWeightsToLbs<T>(data: T): T {
    if (data === null || data === undefined) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map((item) => convertWeightsToLbs(item)) as T;
    }

    if (typeof data === "object") {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(data as Record<string, any>)) {
            // Convert weight fields (but not things like "bodyweightRatio")
            if (
                typeof value === "number" &&
                (key === "weight" ||
                    key === "max_weight" ||
                    key === "maxWeight" ||
                    key === "targetWeight" ||
                    key === "target_weight")
            ) {
                result[key] = kgToLbs(value);
            } else {
                result[key] = convertWeightsToLbs(value);
            }
        }
        return result as T;
    }

    return data;
}
