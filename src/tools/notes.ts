import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";

export function registerNotesTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_day_notes",
        "Get the user's daily journal/notes entries. These contain personal reflections, how they felt, soreness notes, and other day-level annotations.",
        {
            from: z.string().optional().describe("Start date (ISO 8601)"),
            to: z.string().optional().describe("End date (ISO 8601)"),
            limit: z.number().optional().describe("Number of notes to return (default 30)"),
        },
        async (params) => {
            const data = await api.get("/api/v1/data/day-notes", {
                from: params.from,
                to: params.to,
                limit: params.limit,
            });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );
}
