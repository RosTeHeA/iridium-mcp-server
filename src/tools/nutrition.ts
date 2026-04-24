import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { ApiClient } from "../api-client.js";

const optionalMicro = z.number().nonnegative().optional();

/**
 * Resolve the user's timezone for date-window queries. Explicit env var wins
 * (lets users fix the tz when the MCP server runs somewhere other than their
 * own device), otherwise fall back to the machine's local tz.
 */
function resolveUserTz(): string {
    const fromEnv = process.env.IRIDIUM_USER_TZ;
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/** Format a Date as YYYY-MM-DD in the given tz (e.g. "2026-04-21"). */
function localDateString(d: Date, tz: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Normalize a user-facing date parameter. Accepts:
 *   - "today" / "yesterday" → converted to local YYYY-MM-DD in user's tz
 *   - "YYYY-MM-DD"          → passed through
 *   - full ISO timestamp    → passed through
 * Anything else is passed through unchanged.
 */
function normalizeDateParam(value: string | undefined, tz: string): string | undefined {
    if (!value) return undefined;
    const lower = value.trim().toLowerCase();
    if (lower === "today") return localDateString(new Date(), tz);
    if (lower === "yesterday") {
        const y = new Date(Date.now() - 24 * 60 * 60 * 1000);
        return localDateString(y, tz);
    }
    return value;
}

export function registerNutritionTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_nutrition_log",
        "Get DAILY NUTRITION SUMMARIES over a date range — one row per day with " +
        "calorie/macro totals, the user's current goals and targets, and any day " +
        "notes (e.g. 'I didn't log everything today', 'was sick'). Use this for " +
        "trends, goal checking, and weekly/monthly review. " +
        "For individual food-level detail (name + all nutrients per entry), use " +
        "`get_food_entries` instead. " +
        "Dates accept 'today', 'yesterday', 'YYYY-MM-DD', or full ISO timestamps; " +
        "bare dates are interpreted in the user's local timezone. " +
        "IMPORTANT — each summary row includes both `calorieGoal` (the static " +
        "BASE: BMR ± weight-goal deficit, BEFORE activity) and `effectiveCalorieGoal` " +
        "(the real daily target that includes activeCalories burned and the " +
        "daily-minimum floor — matches what the Iridium app actually displays). " +
        "ALWAYS compare consumed vs `effectiveCalorieGoal`, not `calorieGoal`. " +
        "The same applies to the `goals` object at the top level for today.",
        {
            from: z.string().optional().describe("Start date (YYYY-MM-DD, 'today', 'yesterday', or ISO 8601)"),
            to: z.string().optional().describe("End date (YYYY-MM-DD, 'today', 'yesterday', or ISO 8601)"),
            date: z.string().optional().describe("DEPRECATED shortcut — returns individual entries for this date. Prefer `get_food_entries` for entry-level detail."),
        },
        async (params) => {
            const tz = resolveUserTz();
            if (params.date) {
                const data = await api.get("/api/v1/data/nutrition/entries", {
                    date: normalizeDateParam(params.date, tz),
                    tz,
                });
                const warning = api.formatStalenessWarning(data.lastSyncAt);
                return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
            }
            const data = await api.get("/api/v1/data/nutrition", {
                from: normalizeDateParam(params.from, tz),
                to: normalizeDateParam(params.to, tz),
                tz,
            });
            const warning = api.formatStalenessWarning(data.lastSyncAt);
            return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + warning }] };
        }
    );

    server.tool(
        "get_nutrition_goals",
        "Get the user's current nutrition intent — what they are trying to do with " +
        "food right now. Returns: " +
        "`goalType` (lose | maintain | gain), " +
        "`weeklyWeightChangeGoal` (e.g. -1 for losing 1 per week; negative means loss, positive means gain) with `weeklyWeightChangeUnit` (lbs or kg), " +
        "daily targets `calorieGoal` / `proteinGoal` / `carbGoal` / `fatGoal` (grams for macros), " +
        "and mode context (`calorieGoalMode`, `macroDistributionMode`, `macroPriority`, `macroPresetSplit`). " +
        "IMPORTANT — `calorieGoal` is the LIVE EFFECTIVE target for today, matching what the Iridium app shows on the Nutrition tab. " +
        "In automatic + HealthKit-active mode this includes today's active calories burned, so it changes throughout the day as the user moves. " +
        "The static base (BMR ± deficit, before activity) is exposed separately as `calorieGoalBase`. " +
        "When you compare consumed vs target, ALWAYS use `calorieGoal` (not `calorieGoalBase`). " +
        "The optional `todaySnapshot` field breaks down where the number came from: `restingEnergyBurned` (BMR), `activeCalories`, `goalMode`, and `lastUpdated` (the iOS sync timestamp — be aware the active-calories number may be a few minutes stale). " +
        "Use this when coaching the user (\"am I on track?\", \"how much room for dinner?\", \"is this deficit aggressive or conservative?\"), or whenever your recommendation depends on whether they are cutting, bulking, or maintaining. " +
        "Combine with `get_food_entries(date: today)` for what has already been consumed.",
        {},
        async () => {
            try {
                const tz = resolveUserTz();
                const data = await api.get("/api/v1/data/nutrition/goals", { tz });
                const warning = api.formatStalenessWarning(data.lastSyncAt);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify(data, null, 2) + warning
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{
                        type: "text" as const,
                        text: `Failed to fetch nutrition goals: ${message}`
                    }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "get_food_entries",
        "Get full individual food entries with name, macros, and all nutrients — " +
        "for a single day or a date range (up to 90 days). Use this when the user " +
        "asks about WHAT they ate (\"what did I eat yesterday?\", \"show me everything " +
        "I logged this week\", \"what was my dinner Tuesday?\") or when you need " +
        "entry-level detail for analysis (meal patterns, top sources of a macro, " +
        "identifying repeat items, etc.). " +
        "For daily totals / goal tracking / trends, use `get_nutrition_log` instead. " +
        "Pass EITHER `date` (single day) OR `from` + `to` (range). " +
        "Date parameters accept 'today', 'yesterday', 'YYYY-MM-DD', or full ISO " +
        "timestamps; bare dates are interpreted in the user's LOCAL timezone so " +
        "late-night meals correctly land on the same day the user went to bed. " +
        "Ranges are inclusive on both ends and capped at 90 days; results are " +
        "capped at 1000 entries with a `truncated` flag if that cap hits.",
        {
            date: z.string().optional().describe("Single date: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601. Use this OR from+to."),
            from: z.string().optional().describe("Range start: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601. Requires `to`."),
            to: z.string().optional().describe("Range end (inclusive): 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601. Requires `from`."),
        },
        async (params) => {
            if (!params.date && !params.from && !params.to) {
                return {
                    content: [{
                        type: "text" as const,
                        text: "Provide either `date` (single day) or `from` + `to` (range)."
                    }],
                    isError: true,
                };
            }
            try {
                const tz = resolveUserTz();
                const query: Record<string, string> = { tz };
                if (params.date) query.date = normalizeDateParam(params.date, tz)!;
                if (params.from) query.from = normalizeDateParam(params.from, tz)!;
                if (params.to) query.to = normalizeDateParam(params.to, tz)!;
                const data = await api.get("/api/v1/data/nutrition/entries", query);
                const warning = api.formatStalenessWarning(data.lastSyncAt);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify(data, null, 2) + warning
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{
                        type: "text" as const,
                        text: `Failed to fetch food entries: ${message}`
                    }],
                    isError: true,
                };
            }
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
        "The entry appears in the iOS app on the next sync (typically within minutes when the app is foregrounded). " +
        "DEDUPLICATION: calls with identical arguments within one hour are deduplicated (the same entry is returned, not a new one). If the user genuinely ate the same thing twice and wants two entries, set `numberOfServings: 2` on a single call, OR include a differentiating value like a distinct `notes` line or a more specific `date` on the second call.",
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
                // Content-based idempotency: prevents duplicate entries when the
                // MCP client retries or the agent accidentally calls the tool
                // twice with identical arguments. The backend caches results for
                // 1 hour, so identical calls within that window dedupe.
                //
                // To force a new entry for a genuine repeat meal, pass any
                // differentiating value (e.g. a timestamp in `notes`, a different
                // `date`, or a different `numberOfServings`).
                const idempotencyKey = createHash("sha256")
                    .update(JSON.stringify({
                        name: params.name,
                        calories: params.calories,
                        protein: params.protein,
                        carbs: params.carbs,
                        fat: params.fat,
                        date: params.date ?? null,
                        mealType: params.mealType ?? null,
                        numberOfServings: params.numberOfServings ?? null,
                        brand: params.brand ?? null,
                        notes: params.notes ?? null,
                    }))
                    .digest("hex");
                const data = await api.post<{ id: string; createdAt: string }>(
                    "/api/v1/data/nutrition/entries",
                    params,
                    { idempotencyKey }
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

    server.tool(
        "update_food_entry",
        "Update a food entry you previously logged via log_food_entry — e.g. if the user says \"wait, that was 2 cheeseburgers, not 1\" or \"actually that had no cheese.\" " +
        "Required: id (from the prior log_food_entry response). " +
        "Only pass fields you actually want to change — omitted fields stay as they were. " +
        "IMPORTANT: if you are changing calories or macros, they must still be the TOTAL for the amount actually consumed, not per-serving. " +
        "This tool only works on entries that were logged via chat in the first place. If the entry was logged in the Iridium app itself, you will get a 404 — apologise and let the user edit it in the app.",
        {
            id: z.string().min(1).describe("The UUID returned by log_food_entry"),
            // optional — same shape as log_food_entry but everything optional
            name: z.string().min(1).max(200).optional(),
            calories: z.number().nonnegative().max(50000).optional(),
            protein: z.number().nonnegative().max(5000).optional(),
            carbs: z.number().nonnegative().max(5000).optional(),
            fat: z.number().nonnegative().max(5000).optional(),
            date: z.string().optional(),
            mealType: z.enum([
                "breakfast", "lunch", "dinner", "snacks",
                "preWorkout", "postWorkout", "other"
            ]).optional(),
            numberOfServings: z.number().positive().max(100).optional(),
            brand: z.string().max(100).optional(),
            notes: z.string().max(1000).optional(),
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
            const { id, ...fields } = params;
            if (Object.keys(fields).length === 0) {
                return {
                    content: [{
                        type: "text" as const,
                        text: "Nothing to update — pass at least one field to change."
                    }],
                    isError: true,
                };
            }
            try {
                const data = await api.put<{ id: string; updatedAt: string }>(
                    `/api/v1/data/nutrition/entries/${encodeURIComponent(id)}`,
                    fields
                );
                const changed = Object.keys(fields).join(", ");
                return {
                    content: [{
                        type: "text" as const,
                        text: `Updated entry ${data.id}: changed ${changed}. The change will appear in Iridium on the next sync.`
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                // Surface 404 distinctly so the agent can apologise helpfully.
                if (message.includes("(404)")) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: `I can only edit entries I logged for you via chat. That entry (${id}) either was logged in the Iridium app directly, was already removed, or does not exist. The user will need to edit it in the app.`
                        }],
                        isError: true,
                    };
                }
                return {
                    content: [{
                        type: "text" as const,
                        text: `Failed to update food entry: ${message}`
                    }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "list_my_foods",
        "List the user's saved reusable foods (\"My Foods\" in Iridium) — things like their homemade shakes, favourite bars, go-to salads. " +
        "Call this FIRST whenever the user refers to a food by name as if it were already known — for example: \"log my blueberry shake,\" \"another Nuun,\" \"my usual lunch.\" " +
        "If a match exists, reuse its macros and pass the MyFood's name verbatim to log_food_entry so the logged entry reads naturally. " +
        "Scale macros by the actual servings consumed if it differs from the default (defaultServingSize / defaultServingUnit). " +
        "If nothing matches, fall back to your own macro knowledge. You usually only need to call this once per conversation.",
        {},
        async () => {
            try {
                const data = await api.get("/api/v1/data/nutrition/my-foods");
                const warning = api.formatStalenessWarning(data.lastSyncAt);
                return {
                    content: [{
                        type: "text" as const,
                        text: JSON.stringify(data, null, 2) + warning
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{
                        type: "text" as const,
                        text: `Failed to list my foods: ${message}`
                    }],
                    isError: true,
                };
            }
        }
    );
}
