import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";
import { resolveUserTz, normalizeDateParam } from "../utils/dates.js";

export function registerBodyTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_body_measurements",
        "Get body measurement history including weight, body fat percentage, and other measurements over time. " +
        "Dates accept 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601; bare dates are whole days in the user's local timezone. " +
        "Each measurement carries its own `unit` — mass types are converted to the user's preference, while circumference measurements have a null unit because the app records the number without a unit.",
        {
            type: z.string().optional().describe("Measurement type filter (e.g. 'weight', 'body_fat')"),
            from: z.string().optional().describe("Start date: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
            to: z.string().optional().describe("End date, inclusive: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
        },
        async (params) => {
            const tz = resolveUserTz();
            return readTool(api, "body measurements", "/api/v1/data/body-measurements", {
                type: params.type,
                from: normalizeDateParam(params.from, tz),
                to: normalizeDateParam(params.to, tz),
                tz,
            });
        }
    );
}
