import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../api-client.js";

export function registerProfileTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_profile",
        "Get the user's profile including demographics, training goals, methodology, experience level, and app settings.",
        async () => {
            const data = await api.get("/api/v1/data/profile");
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );

    server.tool(
        "get_training_summary",
        "Get aggregate training statistics including total workouts, exercise frequency, streaks, and workout patterns.",
        async () => {
            const data = await api.get("/api/v1/data/summary");
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );
}
