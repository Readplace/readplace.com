import assert from "node:assert";
import { type RequestHandler, Router } from "express";
import { z } from "zod";
import { OAuthClientIdSchema } from "@packages/domain/oauth";
import { AgeRangeSchema, decideAgeAccess, ParentalApprovalSchema } from "@packages/domain/user";
import type { RevokeUserOAuthClient } from "@packages/provider-contracts/oauth";
import { ageAccessSirenError } from "../../api/age-access-siren";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import type { AgeLockAccount } from "./age-lock-account";

export const AGE_RANGE_PATH = "/age-range";

const AgeRangeReportSchema = z.object({ ageRange: AgeRangeSchema, parentalApproval: ParentalApprovalSchema });

export function initAgeRangeRoutes(deps: {
	dualAuth: RequestHandler;
	ageLockAccount: AgeLockAccount;
	revokeUserOAuthClient: RevokeUserOAuthClient;
}): Router {
	const router = Router();

	router.post(AGE_RANGE_PATH, deps.dualAuth, async (req, res) => {
		assert(req.userId, "userId required - route must be protected by dualAuth");
		const report = AgeRangeReportSchema.safeParse(req.body);
		if (!report.success) {
			res.status(400).type(SIREN_MEDIA_TYPE).json(sirenError({ code: "invalid-age-range", message: "ageRange or parentalApproval is not recognised" }));
			return;
		}
		const decision = decideAgeAccess(report.data);
		if (decision === "allowed") {
			res.status(204).end();
			return;
		}
		if (decision === "refused:parental-approval-missing") {
			if (req.oauthClientId !== undefined) {
				await deps.revokeUserOAuthClient({ userId: req.userId, clientId: OAuthClientIdSchema.parse(req.oauthClientId) });
			}
			res.status(403).type(SIREN_MEDIA_TYPE).json(ageAccessSirenError("refusedParentalApproval"));
			return;
		}
		await deps.ageLockAccount(req.userId);
		res.status(403).type(SIREN_MEDIA_TYPE).json(ageAccessSirenError("refusedUnder13"));
	});

	return router;
}
