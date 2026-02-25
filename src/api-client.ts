import { convertUnits } from "./utils/units.js";

const BASE_URL = "https://datasync.iridium.fit";

export class ApiClient {
    private syncId: string;
    private syncKey: string;
    private unitSystem: "imperial" | "metric" | null = null;
    private unitSystemFetchPromise: Promise<"imperial" | "metric"> | null = null;

    constructor(syncId: string, syncKey: string) {
        this.syncId = syncId;
        this.syncKey = syncKey;
    }

    /**
     * Fetch the user's unit system preference (cached after first call).
     */
    private async getUnitSystem(): Promise<"imperial" | "metric"> {
        // Return cached value if available
        if (this.unitSystem !== null) {
            return this.unitSystem;
        }

        // If already fetching, wait for that promise
        if (this.unitSystemFetchPromise !== null) {
            return this.unitSystemFetchPromise;
        }

        // Fetch profile to get unit system
        this.unitSystemFetchPromise = (async () => {
            try {
                const response = await fetch(`${BASE_URL}/api/v1/data/profile`, {
                    method: "GET",
                    headers: {
                        "X-Sync-Id": this.syncId,
                        "X-Sync-Key": this.syncKey,
                        "Content-Type": "application/json",
                    },
                });

                if (response.ok) {
                    const profile = await response.json();
                    const unitSystem = profile?.app_settings?.unit_system;
                    this.unitSystem = unitSystem === "metric" ? "metric" : "imperial";
                } else {
                    // Default to imperial if profile fetch fails
                    this.unitSystem = "imperial";
                }
            } catch {
                // Default to imperial on error
                this.unitSystem = "imperial";
            }
            return this.unitSystem;
        })();

        return this.unitSystemFetchPromise;
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

        // Get user's unit preference and convert units accordingly
        // iOS app stores: weights in kg, distances in meters
        // We convert weights based on user preference, distances based on per-set distanceUnit
        const unitSystem = await this.getUnitSystem();
        const convertWeightsToLbs = unitSystem === "imperial";
        
        return convertUnits(data, convertWeightsToLbs);
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
