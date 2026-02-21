import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";

export function registerBodyTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_body_measurements",
        "Get body measurement history including weight, body fat percentage, and other measurements over time.",
        {
            type: z.string().optional().describe("Measurement type filter (e.g. 'weight', 'body_fat')"),
            from: z.string().optional().describe("Start date (ISO 8601)"),
            to: z.string().optional().describe("End date (ISO 8601)"),
        },
        async (params) => {
            const data = await api.get("/api/v1/data/body-measurements", {
                type: params.type,
                from: params.from,
                to: params.to,
            });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );
}
