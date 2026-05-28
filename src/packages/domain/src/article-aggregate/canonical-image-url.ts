import { z } from "zod";

/* Branded type for the imageUrl that lands in canonical Article metadata
 * after the tier selector picks a winner. The brand exists so a handler
 * cannot pass `winnerSource.metadata.imageUrl` (plain `string | undefined`)
 * straight into a promotion transition — TypeScript rejects the assignment.
 * The only sanctioned producer is `resolveCanonicalImageUrl` in save-link's
 * select-content, which routes the value through `CanonicalImageUrlSchema`
 * (the lone factory) after rescuing an og:image from a losing tier when the
 * winner has none.
 *
 * Without the brand, a future contributor could regress the cross-tier
 * imageUrl rescue by writing `metadata: winnerSource.metadata` directly and
 * silently dropping the fallback — the way the code worked before
 * resolveCanonicalImageUrl existed. The brand makes that regression a
 * compile error. */
export const CanonicalImageUrlSchema = z.string().brand<"CanonicalImageUrl">().optional();
export type CanonicalImageUrl = z.infer<typeof CanonicalImageUrlSchema>;
