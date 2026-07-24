import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";

export function registerWorkoutTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_workout_history",
        "Get recent workout history with optional filtering by date range or category. Returns workout summaries including date, exercises performed, duration, and completion status.",
        {
            limit: z.number().optional().describe("Number of workouts to return (default 20, max 100)"),
            offset: z.number().optional().describe("Pagination offset"),
            from: z.string().optional().describe("Start date (ISO 8601, e.g. 2025-01-01)"),
            to: z.string().optional().describe("End date (ISO 8601)"),
            category: z.string().optional().describe("Filter by workout category"),
        },
        async (params) => {
            return readTool(api, "workout history", "/api/v1/data/workouts", {
                limit: params.limit,
                offset: params.offset,
                from: params.from,
                to: params.to,
                category: params.category,
            });
        }
    );

    server.tool(
        "get_workout_detail",
        "Get full details of a specific workout including all exercises, sets, weights, reps, RPE, and block structure.",
        {
            workout_id: z.string().describe("The workout UUID"),
        },
        async (params) => {
            return readTool(api, "workout detail", `/api/v1/data/workouts/${encodeURIComponent(params.workout_id)}`);
        }
    );
}
