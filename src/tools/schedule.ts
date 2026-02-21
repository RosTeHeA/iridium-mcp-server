import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../api-client.js";

export function registerScheduleTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_weekly_schedule",
        "Get the planned weekly training schedule showing which muscle groups or workout types are assigned to each day.",
        async () => {
            const data = await api.get("/api/v1/data/schedule");
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );
}
