import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";

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
            return readTool(api, "body measurements", "/api/v1/data/body-measurements", {
                type: params.type,
                from: params.from,
                to: params.to,
            });
        }
    );
}
