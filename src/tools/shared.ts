import { ApiClient } from "../api-client.js";

type ToolResult = {
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
};

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
