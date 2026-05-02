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

/**
 * Compute the IANA `tz`'s UTC offset for the given instant, formatted as
 * "+HH:MM" or "-HH:MM". Two-pass calculation handles DST boundaries.
 */
function tzOffsetSuffix(instant: Date, tz: string): string {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false,
    });
    const parts = dtf.formatToParts(instant);
    const get = (t: string) => {
        const part = parts.find((p) => p.type === t);
        return part ? parseInt(part.value, 10) : 0;
    };
    let lh = get("hour");
    if (lh === 24) lh = 0;
    const localAsUTC = Date.UTC(get("year"), get("month") - 1, get("day"), lh, get("minute"), get("second"));
    const offsetMs = localAsUTC - instant.getTime();
    const sign = offsetMs >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMs);
    const hh = String(Math.floor(abs / 3_600_000)).padStart(2, "0");
    const mm = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, "0");
    return `${sign}${hh}:${mm}`;
}

/**
 * Build a fully-qualified ISO 8601 timestamp from local wall-time components,
 * anchored in `tz`. Output: "YYYY-MM-DDTHH:MM:SS±HH:MM".
 *
 * Uses noon UTC on the target date as the reference instant for the offset
 * lookup, which is stable across DST transitions in every region (transitions
 * happen at 02:00–03:00 local, never at noon).
 */
function wallTimeAsLocalISO(dateStr: string, h: number, m: number, s: number, tz: string): string {
    const [y, mo, d] = dateStr.split("-").map((n) => parseInt(n, 10));
    const refInstant = new Date(Date.UTC(y!, mo! - 1, d!, 12, 0, 0));
    const offset = tzOffsetSuffix(refInstant, tz);
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return `${dateStr}T${hh}:${mm}:${ss}${offset}`;
}

/**
 * Normalize a user-facing date string for *logging* into a fully-qualified
 * ISO 8601 timestamp anchored in the user's local timezone. Prevents the
 * "log for yesterday → lands two days ago" bug, where bare YYYY-MM-DD strings
 * downstream parse as UTC midnight (which is the previous day in any
 * negative-offset zone).
 *
 * Accepts:
 *   - undefined → undefined (caller defaults to "now")
 *   - "today" / "yesterday" → noon-local that day
 *   - "today T14:00" / "yesterday 14:00:00" → that wall time, local that day
 *   - "YYYY-MM-DD" → noon-local on that date
 *   - "YYYY-MM-DDTHH:MM[:SS[.SSS]]" without offset → that wall time, local
 *   - Anything ending in `Z` or `±HH[:]MM` → passed through unchanged
 */
function normalizeLogDate(value: string | undefined, tz: string): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;

    // Already has explicit timezone (Z or ±HH:MM): trust it.
    if (/[zZ]$/.test(trimmed) || /[+-]\d{2}:?\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    // "today" / "yesterday" with optional time component.
    const relMatch = trimmed.match(
        /^(today|yesterday)(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i
    );
    if (relMatch) {
        const keyword = relMatch[1]!.toLowerCase() as "today" | "yesterday";
        const baseMs = keyword === "yesterday"
            ? Date.now() - 24 * 60 * 60 * 1000
            : Date.now();
        const dateStr = localDateString(new Date(baseMs), tz);
        const hh = relMatch[2];
        if (hh) {
            return wallTimeAsLocalISO(
                dateStr,
                parseInt(hh, 10),
                parseInt(relMatch[3]!, 10),
                relMatch[4] ? parseInt(relMatch[4], 10) : 0,
                tz
            );
        }
        return wallTimeAsLocalISO(dateStr, 12, 0, 0, tz);
    }

    // Bare YYYY-MM-DD → noon-local on that date.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return wallTimeAsLocalISO(trimmed, 12, 0, 0, tz);
    }

    // "YYYY-MM-DDTHH:MM[:SS[.SSS]]" without timezone → wall time, local.
    const wallMatch = trimmed.match(
        /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
    );
    if (wallMatch) {
        return wallTimeAsLocalISO(
            wallMatch[1]!,
            parseInt(wallMatch[2]!, 10),
            parseInt(wallMatch[3]!, 10),
            wallMatch[4] ? parseInt(wallMatch[4], 10) : 0,
            tz
        );
    }

    // Unknown shape — let the server handle/reject.
    return trimmed;
}

export function registerNutritionTools(server: McpServer, api: ApiClient) {
    server.tool(
        "get_nutrition_log",
        "Get DAILY NUTRITION SUMMARIES over a date range — one row per day with " +
        "the user's actual consumed totals (live, computed from the food log on every call), " +
        "their goals and targets for that day, and any day notes (e.g. 'I didn't log everything today', 'was sick'). " +
        "Use this for daily check-ins, trends, goal checking, and weekly/monthly review. " +
        "For individual food-level detail (name + all nutrients per entry), use " +
        "`get_food_entries` instead. " +
        "Dates accept 'today', 'yesterday', 'YYYY-MM-DD', or full ISO timestamps; " +
        "bare dates are interpreted in the user's local timezone. " +
        "IMPORTANT — each summary row includes: " +
        "(a) `consumed` — an object with the day's actual totals (calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, saturatedFat, transFat); always live, includes food logged via this tool earlier even before the iOS app has synced, " +
        "(b) `calorieGoal` — the static BASE: BMR ± weight-goal deficit, BEFORE activity, " +
        "(c) `effectiveCalorieGoal` — the real daily target that includes activeCalories burned and the daily-minimum floor; matches what the Iridium app actually displays. " +
        "ALWAYS compare `consumed.calories` vs `effectiveCalorieGoal`, not vs `calorieGoal`. " +
        "Some rows may have `consumed` populated but no goal fields — that's a day where food was logged before any goal-bearing data existed for that day; fall back to the top-level `goals` for targets. " +
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
        "DATE/TIMEZONE: pass `date` in any of these forms — 'today', 'yesterday', 'YYYY-MM-DD', " +
        "'today T14:00', 'yesterday 14:30', 'YYYY-MM-DDTHH:MM:SS', or a full ISO 8601 timestamp with offset. " +
        "All bare/relative forms are interpreted in the user's local timezone, so 'yesterday' lands on the user's yesterday — you do not need to know their timezone. " +
        "DEDUPLICATION: calls with identical arguments within one hour are deduplicated (the same entry is returned, not a new one). If the user genuinely ate the same thing twice and wants two entries, set `numberOfServings: 2` on a single call, OR include a differentiating value like a distinct `notes` line or a more specific `date` on the second call.",
        {
            // required
            name: z.string().min(1).max(200),
            calories: z.number().nonnegative().max(50000),
            protein: z.number().nonnegative().max(5000),
            carbs: z.number().nonnegative().max(5000),
            fat: z.number().nonnegative().max(5000),
            // optional core
            date: z.string().optional().describe(
                "When the user ate. Accepts 'today', 'yesterday', 'YYYY-MM-DD', 'today T14:00', " +
                "'yesterday 14:30', 'YYYY-MM-DDTHH:MM:SS', or full ISO 8601 with timezone " +
                "(e.g. '2026-04-29T14:00:00-06:00'). Bare dates anchor to noon local; relative " +
                "keywords resolve in the user's timezone. Defaults to now."
            ),
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
                // Resolve relative ("yesterday") and bare ("YYYY-MM-DD") forms
                // into a fully-qualified ISO timestamp anchored in the user's
                // tz before doing anything else. Idempotency hashes the
                // normalized value so repeated "today" calls still dedupe.
                const tz = resolveUserTz();
                const normalizedDate = normalizeLogDate(params.date, tz);
                const payload = { ...params, date: normalizedDate };

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
                        date: normalizedDate ?? null,
                        mealType: params.mealType ?? null,
                        numberOfServings: params.numberOfServings ?? null,
                        brand: params.brand ?? null,
                        notes: params.notes ?? null,
                    }))
                    .digest("hex");
                const data = await api.post<{ id: string; createdAt: string }>(
                    "/api/v1/data/nutrition/entries",
                    payload,
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
            date: z.string().optional().describe(
                "Same forms as log_food_entry: 'today', 'yesterday', 'YYYY-MM-DD', " +
                "'yesterday 14:30', 'YYYY-MM-DDTHH:MM:SS', or full ISO 8601 with timezone. " +
                "Bare/relative forms resolve in the user's local timezone."
            ),
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
            // Match log_food_entry's date handling so 'yesterday' / 'YYYY-MM-DD'
            // anchor in the user's local tz rather than UTC midnight.
            if (fields.date !== undefined) {
                fields.date = normalizeLogDate(fields.date, resolveUserTz());
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
