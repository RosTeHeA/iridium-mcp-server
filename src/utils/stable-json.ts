/**
 * JSON.stringify with keys sorted, so the output depends only on the content.
 *
 * Needed because the idempotency hash covers the whole payload: plain
 * `JSON.stringify` preserves insertion order, which for a tool call is the
 * order the agent happened to emit its JSON fields in. Two identical meals
 * serialized in different field orders would hash differently and produce
 * duplicate entries — exactly what the key exists to prevent. Keys whose value
 * is `undefined` are dropped, so an omitted optional field and an explicitly
 * undefined one agree.
 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, val) => {
        if (val === null || typeof val !== "object" || Array.isArray(val)) {
            return val;
        }
        return Object.keys(val as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
                const v = (val as Record<string, unknown>)[k];
                if (v !== undefined) acc[k] = v;
                return acc;
            }, {});
    });
}
