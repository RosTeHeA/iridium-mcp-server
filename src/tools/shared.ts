import { ApiClient } from "../api-client.js";

type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
};

export const BASE_EQUIPMENT_WEIGHT_GUIDANCE =
    "Weight fields are backward compatible: `weight` remains the legacy total-load field. " +
    "When present, use `total_weight` for canonical load math, `recorded_weight` for the value originally entered, " +
    "and `base_weight` plus `added_weight` for reviewed base-equipment sets. Never compare or aggregate a row " +
    "whose `review_status` is `unclassified` or `review_required`; its total/base/added fields are intentionally null. " +
    "Older rows without the additive fields remain valid and use `weight` as total load.";

/**
 * Run a read-only GET and render it as a tool result, converting a thrown
 * request error into a readable `isError` result.
 *
 * Without this the read tools let the throw escape to the SDK, which surfaces
 * a bare stringified Error — while the nutrition tools returned a friendly
 * message. Same failure, two different presentations depending on which tool
 * the agent happened to call.
 */
export async function readTool(
    api: ApiClient,
    label: string,
    path: string,
    params?: Record<string, string | number | undefined>
): Promise<ToolResult> {
    try {
        const data = await api.get(path, params);
        const warning = api.formatStalenessWarning(data.lastSyncAt);
        return {
            content: [{ type: "text", text: JSON.stringify(data, null, 2) + warning }],
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            content: [{ type: "text", text: `Failed to fetch ${label}: ${message}` }],
            isError: true,
        };
    }
}
