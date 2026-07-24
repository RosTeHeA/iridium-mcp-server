/**
 * Timezone-aware date handling for the Iridium tools.
 *
 * Two different jobs live here and they are NOT interchangeable:
 *   - `normalizeDateParam` shapes a date for *querying* (day-boundary windows).
 *   - `normalizeLogDate` shapes a date for *writing*, producing a fully
 *     qualified ISO timestamp with an explicit offset so the backend can't
 *     reinterpret a bare date as UTC midnight.
 */
/**
 * Resolve the user's timezone for date-window queries. Explicit env var wins
 * (lets users fix the tz when the MCP server runs somewhere other than their
 * own device), otherwise fall back to the machine's local tz.
 */
export function resolveUserTz(): string {
    const fromEnv = process.env.IRIDIUM_USER_TZ;
    if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/** Format a Date as YYYY-MM-DD in the given tz (e.g. "2026-04-21"). */
export function localDateString(d: Date, tz: string): string {
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
 * Yesterday's local calendar date in `tz`, as YYYY-MM-DD.
 *
 * Done by decrementing the calendar date rather than subtracting 24 hours from
 * the current instant. Local days are not always 24 hours: on the day after a
 * spring-forward the preceding day is only 23 hours long, so `now - 24h` lands
 * *before* it starts and yields the day before yesterday. For a Denver user at
 * 00:30 on 2026-03-09, subtracting 24h gives 2026-03-07 rather than 03-08 —
 * food logged as "yesterday" silently lands two days back.
 */
export function yesterdayLocalDateString(tz: string): string {
    // Read the clock via Date.now(), the way the rest of this module does —
    // a bare `new Date()` bypasses it and can't be pinned in tests.
    const [y, m, d] = localDateString(new Date(Date.now()), tz).split("-").map(Number);
    // Anchor at noon UTC so the ±1 day arithmetic can't be perturbed by an
    // offset; only the Y/M/D fields are read back out.
    const previous = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0) - 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`;
}

/**
 * Normalize a user-facing date parameter. Accepts:
 *   - "today" / "yesterday" → converted to local YYYY-MM-DD in user's tz
 *   - "YYYY-MM-DD"          → passed through
 *   - full ISO timestamp    → passed through
 * Anything else is passed through unchanged.
 */
export function normalizeDateParam(value: string | undefined, tz: string): string | undefined {
    if (!value) return undefined;
    const lower = value.trim().toLowerCase();
    if (lower === "today") return localDateString(new Date(), tz);
    if (lower === "yesterday") return yesterdayLocalDateString(tz);
    return value;
}

/**
 * Compute the IANA `tz`'s UTC offset for the given instant, formatted as
 * "+HH:MM" or "-HH:MM". Two-pass calculation handles DST boundaries.
 */
export function tzOffsetSuffix(instant: Date, tz: string): string {
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
export function wallTimeAsLocalISO(dateStr: string, h: number, m: number, s: number, tz: string): string {
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
export function normalizeLogDate(value: string | undefined, tz: string): string | undefined {
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
        const dateStr = keyword === "yesterday"
            ? yesterdayLocalDateString(tz)
            : localDateString(new Date(), tz);
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
