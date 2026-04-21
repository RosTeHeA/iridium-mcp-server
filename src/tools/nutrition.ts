import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../api-client.js";

const optionalMicro = z.number().nonnegative().optional();

export function registerNutritionTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_nutrition_log",
        "Get daily nutrition data including calorie/macro summaries, the user's current goals and targets, and any day notes for context (e.g. 'I didn't log everything today', 'was sick'). Can also fetch individual food entries for a specific date.",
        {
            from: z.string().optional().describe("Start date (ISO 8601)"),
            to: z.string().optional().describe("End date (ISO 8601)"),
            date: z.string().optional().describe("Specific date to get individual food entries (ISO 8601). If provided, returns food-level detail instead of daily summaries."),
        },
        async (params) => {
            if (params.date) {
                const data = await api.get("/api/v1/data/nutrition/entries", { date: params.date });
                const warning = api.formatStalenessWarning(data.lastSyncAt);
                return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
            }
            const data = await api.get("/api/v1/data/nutrition", { from: params.from, to: params.to });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );

    server.tool(
        "log_food_entry",
        "Log a single food entry (cheeseburger, snack, meal, etc.) into the user's Iridium food diary. " +
        "Required: name + calories + protein + carbs + fat (grams). " +
        "IMPORTANT: calories and macros MUST be the totals for the amount actually consumed, " +
        "NOT per-serving values. If the user ate 2 servings of a 200-cal item, send calories: 400. " +
        "Optional: any micros you are confident about (fiber, sugar, sodium, vitamins, etc.) — " +
        "omit values you don't know rather than guessing. " +
        "The entry appears in the iOS app on the next sync (typically within minutes when the app is foregrounded).",
        {
            // required
            name: z.string().min(1).max(200),
            calories: z.number().nonnegative().max(50000),
            protein: z.number().nonnegative().max(5000),
            carbs: z.number().nonnegative().max(5000),
            fat: z.number().nonnegative().max(5000),
            // optional core
            date: z.string().optional().describe("ISO 8601 timestamp; defaults to now"),
            mealType: z.enum([
                "breakfast", "lunch", "dinner", "snacks",
                "preWorkout", "postWorkout", "other"
            ]).optional().describe("Defaults to 'snacks' if omitted"),
            numberOfServings: z.number().positive().max(100).optional(),
            brand: z.string().max(100).optional(),
            notes: z.string().max(1000).optional(),
            // optional micros (grams unless noted; vitamins/minerals in their natural units per FoodEntry)
            fiber: optionalMicro,
            sugar: optionalMicro,
            sodium: optionalMicro.describe("mg"),
            cholesterol: optionalMicro.describe("mg"),
            saturatedFat: optionalMicro,
            transFat: optionalMicro,
            monounsaturatedFat: optionalMicro,
            polyunsaturatedFat: optionalMicro,
            potassium: optionalMicro.describe("mg"),
            calcium: optionalMicro.describe("mg"),
            iron: optionalMicro.describe("mg"),
            magnesium: optionalMicro.describe("mg"),
            zinc: optionalMicro.describe("mg"),
            vitaminA: optionalMicro.describe("mcg RAE"),
            vitaminB6: optionalMicro.describe("mg"),
            vitaminB12: optionalMicro.describe("mcg"),
            vitaminC: optionalMicro.describe("mg"),
            vitaminD: optionalMicro.describe("mcg"),
            vitaminE: optionalMicro.describe("mg"),
            vitaminK: optionalMicro.describe("mcg"),
            folate: optionalMicro.describe("mcg"),
            niacin: optionalMicro.describe("mg"),
            riboflavin: optionalMicro.describe("mg"),
            thiamin: optionalMicro.describe("mg"),
            caffeine: optionalMicro.describe("mg"),
            water: optionalMicro.describe("mL"),
        },
        async (params) => {
            try {
                const data = await api.post<{ id: string; createdAt: string }>(
                    "/api/v1/data/nutrition/entries",
                    params
                );
                return {
                    content: [{
                        type: "text" as const,
                        text: `Logged "${params.name}" — ${params.calories} kcal, ` +
                              `${params.protein}P / ${params.carbs}C / ${params.fat}F. ` +
                              `It will appear in Iridium on the next sync. (id: ${data.id})`
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{
                        type: "text" as const,
                        text: `Failed to log food entry: ${message}`
                    }],
                    isError: true,
                };
            }
        }
    );
}
