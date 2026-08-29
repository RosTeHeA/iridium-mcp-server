import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { BASE_EQUIPMENT_WEIGHT_GUIDANCE, readTool } from "./shared.js";

export function registerExerciseTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_exercise_progress",
        "Get performance history and 1RM trends for a specific exercise. Shows recent sets, weight progression, and estimated one-rep max over time. " +
        BASE_EQUIPMENT_WEIGHT_GUIDANCE,
        {
            exercise_id: z.string().describe("The exercise ID"),
        },
        async (params) => {
            return readTool(api, "exercise progress", `/api/v1/data/exercises/${encodeURIComponent(params.exercise_id)}/progress`);
        }
    );

    server.tool(
        "get_personal_records",
        "Get personal records (PRs) across all exercises or for a specific exercise. Shows best 1RM, heaviest weight, most reps, and when each PR was set. " +
        "The response's `weightReview` metadata reports whether ambiguous historical base-equipment sets were excluded. " +
        BASE_EQUIPMENT_WEIGHT_GUIDANCE,
        {
            exercise_name: z.string().optional().describe("Filter by exercise name (e.g. 'bench press')"),
            limit: z.number().optional().describe("Number of exercises to return PRs for (default 20)"),
        },
        async (params) => {
            return readTool(api, "personal records", "/api/v1/data/personal-records", {
                exercise_name: params.exercise_name,
                limit: params.limit,
            });
        }
    );
}
