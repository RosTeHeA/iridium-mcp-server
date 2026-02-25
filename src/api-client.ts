import { convertWeightsToLbs } from "./utils/units.js";

const BASE_URL = "https://datasync.iridium.fit";

export class ApiClient {
    private syncId: string;
    private syncKey: string;

    constructor(syncId: string, syncKey: string) {
        this.syncId = syncId;
        this.syncKey = syncKey;
    }

    async get<T = any>(path: string, params?: Record<string, string | number | undefined>): Promise<T & { lastSyncAt: string | null }> {
        const url = new URL(path, BASE_URL);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }

        const response = await fetch(url.toString(), {
            method: "GET",
            headers: {
                "X-Sync-Id": this.syncId,
                "X-Sync-Key": this.syncKey,
                "Content-Type": "application/json",
            },
        });

        if (!response.ok) {
            const body = await response.text();
            throw new Error(`API request failed (${response.status}): ${body}`);
        }

        const data = await response.json();
        
        // iOS app stores all weights in kg. Convert to lbs for display.
        // The _units field already says "lbs" so we make the data match.
        return convertWeightsToLbs(data);
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
