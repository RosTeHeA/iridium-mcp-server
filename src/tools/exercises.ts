import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";

export function registerExerciseTools(server: McpServer, api: ApiClient) {
    server.tool(
        "search_exercises",
        "Search the exercise database by name or muscle group. Returns exercise details including equipment needed, muscles worked, and whether it's time-based or bodyweight.",
        {
            search: z.string().optional().describe("Search by exercise name (e.g. 'bench press', 'squat')"),
            muscle_group: z.string().optional().describe("Filter by muscle group (e.g. 'chest', 'back', 'legs')"),
        },
        async (params) => {
            const data = await api.get("/api/v1/data/exercises", {
                search: params.search,
                muscle_group: params.muscle_group,
            });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );

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
}
