import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { type ConsumeAgeUnlockToken, VerificationTokenSchema } from "@packages/provider-contracts/email-verification";
import type { ClearAgeLock, DestroyUserSessions } from "@packages/provider-contracts/auth";
import type { DeleteAgeLockDeletionSchedule } from "@packages/provider-contracts/trial-scheduler";
import { bannerStateFromRequest, sendComponent } from "@packages/web-shell";
import { Base } from "../../base.component";
import { AgeUnlockedPage, AgeUnlockInvalidPage, AgeUnlockPage } from "./age-lock.component";

const UnlockTokenSchema = z.object({ token: z.string().min(1).pipe(VerificationTokenSchema) });

export function initAgeUnlockRoutes(deps: {
	consumeAgeUnlockToken: ConsumeAgeUnlockToken;
	clearAgeLock: ClearAgeLock;
	deleteAgeLockDeletionSchedule: DeleteAgeLockDeletionSchedule;
	destroyUserSessions: DestroyUserSessions;
}): Router {
	const router = Router();

	router.get("/", (req: Request, res: Response) => {
		const parsed = UnlockTokenSchema.safeParse(req.query);
		const page = parsed.success ? AgeUnlockPage(parsed.data.token) : AgeUnlockInvalidPage();
		sendComponent(req, res, Base(page, bannerStateFromRequest(req)));
	});

	router.post("/", async (req: Request, res: Response) => {
		const parsed = UnlockTokenSchema.safeParse(req.body);
		const consumed = parsed.success ? await deps.consumeAgeUnlockToken(parsed.data.token) : { ok: false as const };
		if (!consumed.ok || (await deps.clearAgeLock(consumed.userId)) === "not-locked") {
			sendComponent(req, res, Base(AgeUnlockInvalidPage(), bannerStateFromRequest(req)));
			return;
		}
		await deps.deleteAgeLockDeletionSchedule({ userId: consumed.userId });
		await deps.destroyUserSessions(consumed.userId);
		sendComponent(req, res, Base(AgeUnlockedPage(), bannerStateFromRequest(req)));
	});

	return router;
}
