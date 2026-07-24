import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";

export function registerScheduleTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_weekly_schedule",
        "Get the planned weekly training schedule showing which muscle groups or workout types are assigned to each day.",
        async () => {
            return readTool(api, "weekly schedule", "/api/v1/data/schedule");
        }
    );
}
