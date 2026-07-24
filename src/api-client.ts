const BASE_URL = "https://datasync.iridium.fit";

/**
 * How long to wait on the backend before giving up. Without this a hung
 * backend hangs the MCP tool call indefinitely — `fetch` has no default
 * timeout, so the agent just stalls with no error to report.
 */
const REQUEST_TIMEOUT_MS = 30_000;

export class ApiClient {
    private syncId: string;
    private syncKey: string;

    constructor(syncId: string, syncKey: string) {
        this.syncId = syncId;
        this.syncKey = syncKey;
    }

    private headers(extra?: Record<string, string>): Record<string, string> {
        return {
            "X-Sync-Id": this.syncId,
            "X-Sync-Key": this.syncKey,
            "Content-Type": "application/json",
            ...extra,
        };
    }

    private async request(url: string, init: RequestInit): Promise<Response> {
        let response: Response;
        try {
            response = await fetch(url, {
                ...init,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (err) {
            if (err instanceof Error && err.name === "TimeoutError") {
                throw new Error(
                    `API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${init.method} ${url}`
                );
            }
            throw err;
        }

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`API request failed (${response.status}): ${body}`);
        }

        return response;
    }

    /**
     * Unit conversion is the backend's job, not ours.
     *
     * The datasync API converts weights (kg → lbs) and distances (m → each
     * set's own distanceUnit) server-side from the user's
     * `app_settings.unit_system`, and reports what it did in a `_units` field
     * on the response. This client used to convert a second time on top of
     * that, which multiplied every imperial weight by 2.2046 twice (a 100 kg
     * lift read as ~486 lb) and re-converted already-converted distances into
     * nonsense (1609 m → 1.0 mi → 0.00062). Pass responses through untouched.
     */
    async get<T = any>(
        path: string,
        params?: Record<string, string | number | undefined>
    ): Promise<T & { lastSyncAt: string | null }> {
        const url = new URL(path, BASE_URL);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        const response = await this.request(url.toString(), {
            method: "GET",
            headers: this.headers(),
        });

        return response.json();
    }

    async post<T = any>(
        path: string,
        body: Record<string, any>,
        options?: { idempotencyKey?: string }
    ): Promise<T> {
        const url = new URL(path, BASE_URL);
        const response = await this.request(url.toString(), {
            method: "POST",
            headers: this.headers(
                options?.idempotencyKey
                    ? { "X-Idempotency-Key": options.idempotencyKey }
                    : undefined
            ),
            body: JSON.stringify(body),
        });

        return response.json();
    }

    async put<T = any>(
        path: string,
        body: Record<string, any>,
        options?: { idempotencyKey?: string }
    ): Promise<T> {
        const url = new URL(path, BASE_URL);
        const response = await this.request(url.toString(), {
            method: "PUT",
            headers: this.headers(
                options?.idempotencyKey
                    ? { "X-Idempotency-Key": options.idempotencyKey }
                    : undefined
            ),
            body: JSON.stringify(body),
        });

        return response.json();
    }

    /**
     * Returns a stale data warning string if data is older than 24 hours, or empty string.
     */
    formatStalenessWarning(lastSyncAt: string | null): string {
        if (!lastSyncAt) {
            return "\n\n⚠️ No data has been synced yet. Open Iridium and tap Sync Now.";
        }
        const syncDate = new Date(lastSyncAt);
        const hoursSince = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60);
        if (hoursSince > 24) {
            const days = Math.floor(hoursSince / 24);
            const timeAgo = days > 1 ? `${days} days ago` : "over 24 hours ago";
            return `\n\n⚠️ Data was last synced ${timeAgo}. Open Iridium and tap Sync Now for the latest.`;
        }
        return "";
    }
}
