import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { ApiClient } from "../api-client.js";
import { readTool } from "./shared.js";
import { resolveUserTz, normalizeDateParam, normalizeLogDate } from "../utils/dates.js";
import { stableStringify } from "../utils/stable-json.js";

const ML_PER_FL_OZ = 29.5735295625;

export function registerHydrationTools(server: McpServer, api: ApiClient) {
    server.tool(
        "log_hydration",
        "Log water (or any hydrating drink volume) into the user's Iridium hydration tracker. " +
        "USE THIS — not `log_food_entry` — whenever the user says they drank water, " +
        "e.g. 'I had a glass of water', 'log 16 oz of water', 'just finished my water bottle'. " +
        "The `water` field on a food entry is the water CONTENT of that food and does NOT count " +
        "toward the hydration ring the user sees in the app; only this tool does. " +
        "Pass EITHER `amountOz` OR `amountML` — give whichever unit the user used and the server " +
        "stores both. Common volumes: a cup is 8 oz, a pint 16 oz, a standard bottle 16.9 oz (500 mL), " +
        "a litre 33.8 oz. " +
        "If the user drank something that is both food and fluid (a protein shake, juice, milk), log the " +
        "calories and macros with `log_food_entry` AND the fluid volume with this tool — they are " +
        "separate records and the app expects both. Plain water needs only this tool. " +
        "DATE/TIMEZONE: `date` accepts 'today', 'yesterday', 'YYYY-MM-DD', 'today T14:00', " +
        "'yesterday 14:30', or a full ISO 8601 timestamp; bare and relative forms resolve in the " +
        "user's local timezone. Defaults to now. " +
        "DEDUPLICATION: identical calls within an hour are treated as the same entry. For a genuine " +
        "second drink, pass a more specific `date` or a distinguishing `note`.",
        {
            amountOz: z.number().positive().max(338).optional()
                .describe("Volume in US fluid ounces. Use this when the user speaks in oz, cups, or bottles."),
            amountML: z.number().positive().max(10000).optional()
                .describe("Volume in millilitres. Use this when the user speaks in mL or litres."),
            date: z.string().optional()
                .describe("When they drank it: 'today', 'yesterday', 'YYYY-MM-DD', 'yesterday 14:30', or ISO 8601. Defaults to now."),
            note: z.string().max(500).optional()
                .describe("Optional context, e.g. 'post-workout' or 'with lunch'."),
        },
        async (params) => {
            if (params.amountOz === undefined && params.amountML === undefined) {
                return {
                    content: [{
                        type: "text" as const,
                        text: "Provide the volume as either `amountOz` (US fluid ounces) or `amountML` (millilitres)."
                    }],
                    isError: true,
                };
            }

            // Convert once, here, so the wire format is always millilitres —
            // the unit the iOS hydration model stores.
            const amountML = params.amountML !== undefined
                ? params.amountML
                : Math.round(params.amountOz! * ML_PER_FL_OZ);

            try {
                const tz = resolveUserTz();
                const normalizedDate = normalizeLogDate(params.date, tz);
                const payload = {
                    amountML,
                    date: normalizedDate,
                    note: params.note,
                };

                const idempotencyKey = createHash("sha256")
                    .update(stableStringify(payload))
                    .digest("hex");

                const data = await api.post<{ id: string; entry?: { amountML: number; amountOz: number } }>(
                    "/api/v1/data/hydration/entries",
                    payload,
                    { idempotencyKey }
                );

                const oz = data.entry?.amountOz ?? Math.round((amountML / ML_PER_FL_OZ) * 10) / 10;
                return {
                    content: [{
                        type: "text" as const,
                        text: `Logged ${oz} fl oz (${amountML} mL) of water to your hydration tracker. ` +
                              `It will appear in Iridium on the next sync. (id: ${data.id})`
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                    content: [{ type: "text" as const, text: `Failed to log hydration: ${message}` }],
                    isError: true,
                };
            }
        }
    );

    server.tool(
        "get_hydration",
        "Get the user's water intake — individual hydration entries plus per-day totals against " +
        "their saved hydration goal. Use this for 'how much water have I had today?', " +
        "'am I hitting my hydration goal?', or any question about fluid intake. " +
        "Each day in `byDay` carries `consumedML`/`consumedOz`, `goalML`/`goalOz`, `remainingML`, " +
        "and `progress` (0-1) when a goal exists for that day. " +
        "Compare `consumedML` against `goalML`, and report in whichever unit the user speaks in. " +
        "Note this covers hydration only — it does NOT include the water content of foods, which " +
        "the Iridium app also excludes from the hydration ring. " +
        "Dates accept 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601; bare dates are whole days " +
        "in the user's local timezone. Pass EITHER `date` for a single day OR `from` + `to` for a range.",
        {
            date: z.string().optional().describe("Single day: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
            from: z.string().optional().describe("Range start: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
            to: z.string().optional().describe("Range end, inclusive: 'today', 'yesterday', 'YYYY-MM-DD', or ISO 8601"),
        },
        async (params) => {
            const tz = resolveUserTz();
            // Default to today rather than returning the entire history: the
            // overwhelmingly common question is "how much have I had today?"
            const single = params.date ?? (!params.from && !params.to ? "today" : undefined);
            return readTool(api, "hydration", "/api/v1/data/hydration/entries", {
                date: normalizeDateParam(single, tz),
                from: normalizeDateParam(params.from, tz),
                to: normalizeDateParam(params.to, tz),
                tz,
            });
        }
    );

    server.tool(
        "update_hydration_entry",
        "Correct a hydration entry you previously logged via `log_hydration` — e.g. " +
        "\"that was a 32 oz bottle, not 16\". Required: id (from the prior log_hydration response). " +
        "Only pass what you want to change. " +
        "This only works on entries logged via chat; water added in the Iridium app itself returns " +
        "a 404 and has to be edited there.",
        {
            id: z.string().min(1).describe("The id returned by log_hydration"),
            amountOz: z.number().positive().max(338).optional().describe("Corrected volume in US fluid ounces"),
            amountML: z.number().positive().max(10000).optional().describe("Corrected volume in millilitres"),
            date: z.string().optional().describe("Same date forms as log_hydration"),
            note: z.string().max(500).optional(),
        },
        async (params) => {
            const { id, amountOz, amountML, date, note } = params;
            const fields: Record<string, unknown> = {};
            if (amountML !== undefined) fields.amountML = amountML;
            else if (amountOz !== undefined) fields.amountML = Math.round(amountOz * ML_PER_FL_OZ);
            if (date !== undefined) fields.date = normalizeLogDate(date, resolveUserTz());
            if (note !== undefined) fields.note = note;

            if (Object.keys(fields).length === 0) {
                return {
                    content: [{ type: "text" as const, text: "Nothing to update — pass at least one field to change." }],
                    isError: true,
                };
            }

            try {
                const idempotencyKey = createHash("sha256")
                    .update(stableStringify({ id, ...fields }))
                    .digest("hex");
                const data = await api.put<{ id: string; entry?: { amountML: number; amountOz: number } }>(
                    `/api/v1/data/hydration/entries/${encodeURIComponent(id)}`,
                    fields,
                    { idempotencyKey }
                );
                const entry = data.entry;
                const amount = entry ? ` Now ${entry.amountOz} fl oz (${entry.amountML} mL).` : "";
                return {
                    content: [{
                        type: "text" as const,
                        text: `Updated hydration entry ${data.id}.${amount} The change will appear in Iridium on the next sync.`
                    }]
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (message.includes("(404)")) {
                    return {
                        content: [{
                            type: "text" as const,
                            text: `I can only edit hydration entries I logged for you via chat. That entry (${id}) was either added in the Iridium app directly, already removed, or does not exist. It will need to be edited in the app.`
                        }],
                        isError: true,
                    };
                }
                return {
                    content: [{ type: "text" as const, text: `Failed to update hydration entry: ${message}` }],
                    isError: true,
                };
            }
        }
    );
}
