import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";

export function registerExerciseTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_exercise_progress",
        "Get performance history and 1RM trends for a specific exercise. Shows recent sets, weight progression, and estimated one-rep max over time.",
        {
            exercise_id: z.string().describe("The exercise ID"),
        },
        async (params) => {
            const data = await api.get(`/api/v1/data/exercises/${params.exercise_id}/progress`);
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );

    server.tool(
        "get_personal_records",
        "Get personal records (PRs) across all exercises or for a specific exercise. Shows best 1RM, heaviest weight, most reps, and when each PR was set.",
        {
            exercise_name: z.string().optional().describe("Filter by exercise name (e.g. 'bench press')"),
            limit: z.number().optional().describe("Number of exercises to return PRs for (default 20)"),
        },
        async (params) => {
            const data = await api.get("/api/v1/data/personal-records", {
                exercise_name: params.exercise_name,
                limit: params.limit,
            });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );
}
