/**
 * Unit conversion utilities.
 * iOS app stores:
 * - Weights in kilograms internally
 * - Distances in meters internally
 * MCP server converts to user's preferred units before returning.
 */

const KG_TO_LBS = 2.20462;

// Meters to other units
const METERS_TO = {
    m: 1,
    km: 0.001,
    mi: 0.000621371,
    ft: 3.28084,
    yd: 1.09361,
};

/**
 * Convert kilograms to pounds, rounded to 1 decimal place.
 */
export function kgToLbs(kg: number): number {
    return Math.round(kg * KG_TO_LBS * 10) / 10;
}

/**
 * Convert meters to the specified distance unit, rounded appropriately.
 */
export function metersTo(meters: number, unit: string): number {
    const factor = METERS_TO[unit as keyof typeof METERS_TO];
    if (!factor) return meters; // Unknown unit, return as-is
    
    const converted = meters * factor;
    // Round to 2 decimals for km/mi, 1 decimal for m/ft/yd
    const decimals = (unit === "km" || unit === "mi") ? 2 : 1;
    return Math.round(converted * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Weight field names that should be converted from kg.
 */
const WEIGHT_FIELDS = new Set([
    "weight",
    "max_weight",
    "maxWeight",
    "targetWeight",
    "target_weight",
]);

/**
 * Distance field names that should be converted from meters.
 */
const DISTANCE_FIELDS = new Set([
    "distance",
    "targetDistance",
    "target_distance",
    "totalDistance",
    "total_distance",
    "max_distance",
    "maxDistance",
]);

/**
 * Recursively convert all weight and distance fields in an object.
 * 
 * - Weights: converted from kg to lbs if convertWeightsToLbs is true
 * - Distances: converted from meters to the unit specified in the sibling
 *   distanceUnit/distance_unit field (per-set basis)
 * 
 * @param data - The data to convert
 * @param convertWeightsToLbs - If true, convert kg to lbs. If false, leave as kg.
 */
export function convertUnits<T>(data: T, convertWeightsToLbs: boolean): T {
    if (data === null || data === undefined) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map((item) => convertUnits(item, convertWeightsToLbs)) as T;
    }

    if (typeof data === "object") {
        const obj = data as Record<string, any>;
        const result: Record<string, any> = {};
        
        // First pass: find distanceUnit for this object level
        const distanceUnit = obj.distanceUnit || obj.distance_unit;
        
        for (const [key, value] of Object.entries(obj)) {
            // Update the _units field to reflect actual weight units
            if (key === "_units" && typeof value === "object" && value !== null) {
                result[key] = {
                    ...value,
                    weight: convertWeightsToLbs ? "lbs" : "kg",
                    // Distance note: each set specifies its own unit via distanceUnit field
                    distance: "per-set (see distanceUnit field)",
                };
            }
            // Convert weight fields if imperial
            else if (typeof value === "number" && WEIGHT_FIELDS.has(key)) {
                result[key] = convertWeightsToLbs ? kgToLbs(value) : value;
            }
            // Convert distance fields using sibling distanceUnit
            else if (typeof value === "number" && DISTANCE_FIELDS.has(key) && distanceUnit) {
                result[key] = metersTo(value, distanceUnit);
            }
            // Recurse into nested objects/arrays
            else {
                result[key] = convertUnits(value, convertWeightsToLbs);
            }
        }
        return result as T;
    }

    return data;
}
