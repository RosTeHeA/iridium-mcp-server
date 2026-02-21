import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";

export function registerNutritionTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_nutrition_log",
        "Get daily nutrition summaries showing calories, protein, carbs, fat, and goal adherence. Can also fetch individual food entries for a specific date.",
        {
            from: z.string().optional().describe("Start date (ISO 8601)"),
            to: z.string().optional().describe("End date (ISO 8601)"),
            date: z.string().optional().describe("Specific date to get individual food entries (ISO 8601). If provided, returns food-level detail instead of daily summaries."),
        },
        async (params) => {
            if (params.date) {
                const data = await api.get("/api/v1/data/nutrition/entries", { date: params.date });
                const warning = api.formatStalenessWarning(data.lastSyncAt);
                return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
            }
            const data = await api.get("/api/v1/data/nutrition", { from: params.from, to: params.to });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );
}
