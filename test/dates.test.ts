import { test } from "node:test";
import assert from "node:assert/strict";
import {
    localDateString,
    yesterdayLocalDateString,
    normalizeDateParam,
    normalizeLogDate,
} from "../build/utils/dates.js";

const DENVER = "America/Denver";
const TOKYO = "Asia/Tokyo";

/**
 * Run `fn` with `Date.now()` pinned to a fixed instant, so the relative-date
 * helpers can be tested across DST boundaries.
 */
function atInstant<T>(iso: string, fn: () => T): T {
    const fixed = new Date(iso).getTime();
    const realNow = Date.now;
    Date.now = () => fixed;
    try {
        return fn();
    } finally {
        Date.now = realNow;
    }
}

test("localDateString renders the local calendar date, not the UTC one", () => {
    // 01:30 UTC on the 25th is still the 24th in Denver.
    const instant = new Date("2026-07-25T01:30:00Z");
    assert.equal(localDateString(instant, DENVER), "2026-07-24");
    assert.equal(localDateString(instant, "UTC"), "2026-07-25");
    // ...and already the 25th in Tokyo.
    assert.equal(localDateString(instant, TOKYO), "2026-07-25");
});

test("yesterday is the previous calendar day on an ordinary day", () => {
    atInstant("2026-07-24T18:00:00Z", () => {
        assert.equal(yesterdayLocalDateString(DENVER), "2026-07-23");
    });
});

test("yesterday crosses a month boundary", () => {
    atInstant("2026-08-01T18:00:00Z", () => {
        assert.equal(yesterdayLocalDateString(DENVER), "2026-07-31");
    });
});

test("yesterday crosses a year boundary", () => {
    atInstant("2027-01-01T18:00:00Z", () => {
        assert.equal(yesterdayLocalDateString(DENVER), "2026-12-31");
    });
});

test("yesterday handles a leap day", () => {
    atInstant("2028-03-01T18:00:00Z", () => {
        assert.equal(yesterdayLocalDateString(DENVER), "2028-02-29");
    });
});

/**
 * The regression this helper exists for.
 *
 * US DST starts 2026-03-08, making that local day 23 hours long. At 00:30
 * local on the 9th, subtracting a flat 24 hours lands at 23:30 on the 7th —
 * so "yesterday" resolved to 03-07 instead of 03-08, and food logged as
 * "yesterday" silently landed two days back.
 */
test("yesterday is correct in the hour after a spring-forward", () => {
    // Denver's 2026 transition is 02:00 MST → 03:00 MDT on Mar 8 (09:00Z), so
    // local Mar 8 spans [Mar 8 07:00Z, Mar 9 06:00Z) — 23 hours. The naive
    // `now - 24h` only misfires while `now` is in [Mar 9 06:00Z, Mar 9 07:00Z),
    // i.e. the first local hour of Mar 9.
    // 2026-03-09T06:30Z == 2026-03-09T00:30 MDT (UTC-6).
    atInstant("2026-03-09T06:30:00Z", () => {
        assert.equal(localDateString(new Date(Date.now()), DENVER), "2026-03-09");
        assert.equal(yesterdayLocalDateString(DENVER), "2026-03-08");

        // The naive implementation this replaced:
        const naive = localDateString(new Date(Date.now() - 24 * 3600 * 1000), DENVER);
        assert.equal(naive, "2026-03-07", "sanity: the old approach really was wrong here");
    });
});

test("yesterday is correct in the hour after a fall-back", () => {
    // 2026-11-02T07:30Z == 2026-11-02T00:30 MST (UTC-7); Nov 1 was 25 hours.
    atInstant("2026-11-02T07:30:00Z", () => {
        assert.equal(yesterdayLocalDateString(DENVER), "2026-11-01");
    });
});

test("normalizeDateParam passes through explicit dates untouched", () => {
    assert.equal(normalizeDateParam("2026-04-21", DENVER), "2026-04-21");
    assert.equal(normalizeDateParam(undefined, DENVER), undefined);
    assert.equal(
        normalizeDateParam("2026-04-21T10:00:00Z", DENVER),
        "2026-04-21T10:00:00Z"
    );
});

test("normalizeDateParam resolves relative keywords case-insensitively", () => {
    atInstant("2026-07-24T18:00:00Z", () => {
        assert.equal(normalizeDateParam("today", DENVER), "2026-07-24");
        assert.equal(normalizeDateParam("Yesterday", DENVER), "2026-07-23");
        assert.equal(normalizeDateParam("  TODAY  ", DENVER), "2026-07-24");
    });
});

test("normalizeLogDate anchors a bare date at local noon, never UTC midnight", () => {
    const result = normalizeLogDate("2026-04-29", DENVER);
    assert.equal(result, "2026-04-29T12:00:00-06:00");
    // The whole point: it must land on 04-29 locally, not slip to 04-28.
    assert.equal(localDateString(new Date(result!), DENVER), "2026-04-29");
});

test("normalizeLogDate picks the right offset either side of a DST change", () => {
    // MST (UTC-7) in January, MDT (UTC-6) in July.
    assert.equal(normalizeLogDate("2026-01-15", DENVER), "2026-01-15T12:00:00-07:00");
    assert.equal(normalizeLogDate("2026-07-15", DENVER), "2026-07-15T12:00:00-06:00");
});

test("normalizeLogDate handles a positive UTC offset", () => {
    assert.equal(normalizeLogDate("2026-04-29", TOKYO), "2026-04-29T12:00:00+09:00");
});

test("normalizeLogDate keeps an explicit offset or Z verbatim", () => {
    for (const input of [
        "2026-04-29T14:00:00-06:00",
        "2026-04-29T14:00:00Z",
        "2026-04-29T14:00:00+0530",
    ]) {
        assert.equal(normalizeLogDate(input, DENVER), input);
    }
});

test("normalizeLogDate applies a wall time given without an offset", () => {
    assert.equal(
        normalizeLogDate("2026-04-29T14:30:00", DENVER),
        "2026-04-29T14:30:00-06:00"
    );
    // Seconds optional; fractional seconds tolerated.
    assert.equal(
        normalizeLogDate("2026-04-29T14:30", DENVER),
        "2026-04-29T14:30:00-06:00"
    );
});

test("normalizeLogDate resolves relative keywords with a wall time", () => {
    atInstant("2026-07-24T18:00:00Z", () => {
        assert.equal(
            normalizeLogDate("yesterday 14:30", DENVER),
            "2026-07-23T14:30:00-06:00"
        );
        assert.equal(
            normalizeLogDate("today T09:05:30", DENVER),
            "2026-07-24T09:05:30-06:00"
        );
        // Bare keyword → noon local.
        assert.equal(normalizeLogDate("yesterday", DENVER), "2026-07-23T12:00:00-06:00");
    });
});

test("normalizeLogDate returns undefined for empty input", () => {
    assert.equal(normalizeLogDate(undefined, DENVER), undefined);
    assert.equal(normalizeLogDate("   ", DENVER), undefined);
});

test("normalizeLogDate passes unrecognized shapes through for the server to reject", () => {
    assert.equal(normalizeLogDate("next tuesday", DENVER), "next tuesday");
});
