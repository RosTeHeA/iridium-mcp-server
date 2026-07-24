import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";

export function registerRecoveryTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_training_volume",
        "Get volume adaptation records showing how training volume has been adjusted for each muscle group over time, including fatigue levels and recovery decisions.",
        {
            from: z.string().optional().describe("Start date (ISO 8601)"),
            to: z.string().optional().describe("End date (ISO 8601)"),
            muscle_group: z.string().optional().describe("Filter by muscle group"),
        },
        async (params) => {
            return readTool(api, "training volume", "/api/v1/data/volume-adaptations", {
                from: params.from,
                to: params.to,
                muscle_group: params.muscle_group,
            });
        }
    );

    server.tool(
        "get_trainer_analysis",
        "Get weekly AI trainer analysis logs containing training recommendations, progress assessments, and coaching insights.",
        {
            limit: z.number().optional().describe("Number of logs to return (default 10, max 50)"),
        },
        async (params) => {
            return readTool(api, "trainer analysis", "/api/v1/data/trainer-logs", { limit: params.limit });
        }
    );
}
