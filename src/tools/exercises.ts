import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";
import { readWeightTool } from "./shared.js";

export function registerExerciseTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_exercise_progress",
        "Get performance history and 1RM trends for a specific exercise. Canonical load values use total_weight; " +
        "base_weight + added_weight describes the same resistance for plate-loaded equipment. If review_required " +
        "is true, historical machine entries are ambiguous: do not state a 1RM, PR, volume, or load progression " +
        "until the user finishes Base Weight History in Iridium.",
        {
            exercise_id: z.string().describe("The exercise ID"),
        },
        async (params) => {
            return readWeightTool(api, "exercise progress", `/api/v1/data/exercises/${encodeURIComponent(params.exercise_id)}/progress`, "exercise_progress");
        }
    );

    server.tool(
        "get_personal_records",
        "Get personal records (PRs) across all exercises or for a specific exercise. Load records use canonical " +
        "total resistance. When review_required is true, affected machine-load PRs are suppressed and must not " +
        "be inferred from recorded_weight; ask the user to finish Base Weight History in Iridium. Rep-only records remain usable.",
        {
            exercise_name: z.string().optional().describe("Filter by exercise name (e.g. 'bench press')"),
            limit: z.number().optional().describe("Number of exercises to return PRs for (default 20)"),
        },
        async (params) => {
            return readWeightTool(api, "personal records", "/api/v1/data/personal-records", "personal_records", {
                exercise_name: params.exercise_name,
                limit: params.limit,
            });
        }
    );
}
