import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";
import { resolveUserTz, normalizeDateParam } from "../utils/dates.js";

export function registerWorkoutTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_workout_history",
        "Get recent workout history with optional filtering by date range or category. " +
        "Returns workout summaries including date, exercises performed, duration, and completion status. " +
        "Dates accept 'today', 'yesterday', 'YYYY-MM-DD', or a full ISO 8601 timestamp; bare dates are " +
        "interpreted as whole days in the user's LOCAL timezone, so an early-morning session and a " +
        "late-evening one on the same day both come back from a single-day query. " +
        "To ask about one specific day, pass the SAME date as both `from` and `to`. " +
        "IMPORTANT: a day often contains MORE THAN ONE workout — report every workout in the response, " +
        "not just the first or the most recent.",
        {
            limit: z.number().optional().describe("Number of workouts to return (default 20, max 100)"),
            offset: z.number().optional().describe("Pagination offset"),
            from: z.string().optional().describe("Start date: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
            to: z.string().optional().describe("End date, inclusive: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
            category: z.string().optional().describe("Filter by workout category"),
        },
        async (params) => {
            const tz = resolveUserTz();
            return readTool(api, "workout history", "/api/v1/data/workouts", {
                limit: params.limit,
                offset: params.offset,
                from: normalizeDateParam(params.from, tz),
                to: normalizeDateParam(params.to, tz),
                category: params.category,
                tz,
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
