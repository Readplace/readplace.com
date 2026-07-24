import type { UserIdPrefix } from "@packages/domain/user";
import type { FindUserIdsByPrefix } from "@packages/provider-contracts/auth";
import type { GetEffectiveAccess } from "@packages/subscription-access";

/** Whether the user who shared a public /view link still earns a link that
 * never expires. `unknown` covers a prefix matching nobody (stale or forged),
 * which is treated exactly like a link that carried no sharer at all. */
export type SharerPublicAccess = "valid" | "inactive" | "unknown";

/** A share link identifies its sharer by a 6-hex prefix of the user id, so the
 * subscription — keyed by the full id — can only be reached by resolving the
 * prefix first. Matching more than one user is vanishingly rare but possible,
 * and any one valid subscriber among them is enough to keep the link permanent.
 *
 * Read-only access is reported without its reason: a lapsed trial and a
 * cancelled subscription are deliberately indistinguishable to the reader. */
export async function resolveSharerPublicAccess(
	deps: {
		findUserIdsByPrefix: FindUserIdsByPrefix;
		getEffectiveAccess: GetEffectiveAccess;
	},
	prefix: UserIdPrefix,
): Promise<SharerPublicAccess> {
	const userIds = await deps.findUserIdsByPrefix(prefix);
	if (userIds.length === 0) return "unknown";
	for (const userId of userIds) {
		const access = await deps.getEffectiveAccess(userId);
		if (access.access === "full") return "valid";
	}
	return "inactive";
}
