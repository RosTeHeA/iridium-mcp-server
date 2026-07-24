import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";

export function registerProfileTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_profile",
        "Get the user's profile including demographics, training goals, methodology, experience level, and app settings.",
        async () => {
            return readTool(api, "profile", "/api/v1/data/profile");
        }
    );

    server.tool(
        "get_training_summary",
        "Get aggregate training statistics including total workouts, exercise frequency, streaks, and workout patterns.",
        async () => {
            return readTool(api, "training summary", "/api/v1/data/summary");
        }
    );
}
