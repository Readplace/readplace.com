import type { UserId } from "@packages/domain/user";
import {
	READLIST_MAX_PER_USER,
	nextAvailableReadlistLabel,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { FindUserById, FindUserContactByUserId } from "@packages/provider-contracts/auth";
import type {
	AllocateSavedAtSequence,
	ListReadlistDefinitions,
} from "@packages/provider-contracts/article-store";
import type {
	EngagementStarterState,
	FindPersonalLibrary,
	SaveStarterPack,
	StarterPick,
} from "@packages/provider-contracts/engagement-starter";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import type { HutchLogger } from "@packages/hutch-logger";
import {
	STARTER_CAMPAIGN_ID,
	STARTER_SNAPSHOT_MAX_AGE_MS,
	hasStarterObservation,
	starterArm,
	type StarterRollout,
} from "./starter-policy";
import { reservedDomainOf } from "../../providers/email/skip-reserved-domain";

export function initEnrollStarter(deps: {
	state: EngagementStarterState;
	findUserById: FindUserById;
	findUserContactByUserId: FindUserContactByUserId;
	getEffectiveAccess: GetEffectiveAccess;
	resolveSaveAccess: (userId: UserId) => Promise<{ allowed: boolean }>;
	findPersonalLibrary: FindPersonalLibrary;
	listReadlistDefinitions: ListReadlistDefinitions;
	findReadySnapshot: () => Promise<StarterPick[]>;
	saveStarterPack: SaveStarterPack;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	newReadlistSlug: () => ReadlistSlug;
	findRollout: () => Promise<StarterRollout | undefined>;
	excludedUserIds: string[];
	now: () => Date;
	logger: HutchLogger;
	emit: (input: {
		userId: UserId;
		event: "assigned" | "inserted" | "failure";
		arm: "treatment" | "comparison";
		assignedAt: string;
		tier: "trial" | "paid";
		accountCohort: "existing" | "new";
		reason?: string;
	}) => void;
}): (userId: UserId) => Promise<void> {
	return async (userId) => {
		if (deps.excludedUserIds.includes(userId)) return;
		const rollout = await deps.findRollout();
		if (rollout === undefined) return;
		const now = deps.now();
		const [user, contact, access] = await Promise.all([
			deps.findUserById(userId),
			deps.findUserContactByUserId(userId),
			deps.getEffectiveAccess(userId),
		]);
		if (
			!user?.registeredAt ||
			user.deletedAt !== undefined ||
			!contact?.emailVerified ||
			contact.queueDigestOptOutAt !== undefined
		) {
			return;
		}
		if (reservedDomainOf(contact.email) !== undefined) return;
		if (access.access !== "full" || (access.tier !== "trial" && access.tier !== "paid")) return;
		if (!(await deps.resolveSaveAccess(userId)).allowed) return;
		let state = await deps.state.findEngagement(userId);
		if (state.assignment?.arm === "comparison") return;
		let pack = await deps.state.findStarterPack(userId);
		if (pack?.insertedAt !== undefined || pack?.emailStatus === "suppressed") return;
		if (state.observationStartedAt === undefined) {
			state = await deps.state.observeEngagement({
				userId,
				startedAt: new Date(
					Math.max(Date.parse(user.registeredAt), Date.parse(rollout.observationStartedAt)),
				).toISOString(),
			});
		}
		if (!hasStarterObservation({ state, registeredAt: user.registeredAt, now })) return;
		const [library, definitions, snapshot] = await Promise.all([
			deps.findPersonalLibrary(userId),
			deps.listReadlistDefinitions(userId),
			deps.findReadySnapshot(),
		]);
		if (library.personalCount >= 5 || definitions.length >= READLIST_MAX_PER_USER) return;
		const saved = new Set(library.urls);
		const picks = snapshot
			.filter(
				(pick) =>
					now.getTime() - Date.parse(pick.snapshotAt) >= 0 &&
					now.getTime() - Date.parse(pick.snapshotAt) <= STARTER_SNAPSHOT_MAX_AGE_MS &&
					!saved.has(ArticleResourceUniqueId.parse(pick.url).value),
			)
			.slice(0, 10);
		if (picks.length !== 10) return;
		if (state.assignment === undefined) {
			const assignment = {
				campaignId: STARTER_CAMPAIGN_ID,
				arm: starterArm(userId),
				assignedAt: now.toISOString(),
				tier: access.tier,
				accountCohort:
					Date.parse(user.registeredAt) < Date.parse(rollout.observationStartedAt)
						? ("existing" as const)
						: ("new" as const),
			};
			pack = {
				campaignId: STARTER_CAMPAIGN_ID,
				picks,
				readlist: deps.newReadlistSlug(),
				readlistLabel: nextAvailableReadlistLabel({
					label: "Hacker News picks",
					takenLabels: definitions.map((definition) => definition.label),
				}),
				selectedAt: now.toISOString(),
				emailStatus: "pending",
			};
			if (
				(await deps.state.assignStarter({
					userId,
					revision: state.activityRevision,
					assignment,
					pack,
				})) === "conflict"
			) {
				return;
			}
			deps.emit({ userId, event: "assigned", ...assignment });
			if (assignment.arm === "comparison") return;
			const assignmentRevision = state.activityRevision + 1;
			state = await deps.state.findEngagement(userId);
			if (state.activityRevision !== assignmentRevision) return;
		}
		const assignment = state.assignment;
		if (assignment === undefined || pack === undefined) return;
		const selection = pack;
		if (
			selection.picks.some(
				(pick) =>
					saved.has(ArticleResourceUniqueId.parse(pick.url).value) ||
					now.getTime() - Date.parse(pick.snapshotAt) > STARTER_SNAPSHOT_MAX_AGE_MS,
			) ||
			definitions.some(
				(definition) =>
					definition.slug === selection.readlist ||
					definition.label.toLowerCase() === selection.readlistLabel.toLowerCase(),
			)
		) {
			const next = {
				...pack,
				picks,
				readlist: deps.newReadlistSlug(),
				readlistLabel: nextAvailableReadlistLabel({
					label: "Hacker News picks",
					takenLabels: definitions.map((definition) => definition.label),
				}),
				selectedAt: now.toISOString(),
			};
			if (
				(await deps.state.replaceStarterSelection({
					userId,
					selectedAt: pack.selectedAt,
					pack: next,
				})) === "conflict"
			) {
				return;
			}
			pack = next;
		}
		try {
			const result = await deps.saveStarterPack({
				userId,
				activityRevision: state.activityRevision,
				pack,
				savedAt: await deps.allocateSavedAtSequence({ userId, count: 10 }),
				at: now,
			});
			if (result === "conflict") {
				await deps.state.recordStarterInsertionFailure({
					userId,
					selectedAt: pack.selectedAt,
					at: now,
					outcome: "conflict",
				});
			}
			deps.emit({
				userId,
				...assignment,
				event: result === "inserted" ? "inserted" : "failure",
				...(result === "conflict" ? { reason: "insertion-conflict" } : {}),
			});
		} catch (error) {
			deps.emit({ userId, ...assignment, event: "failure", reason: "insertion-failed" });
			await deps.state.recordStarterInsertionFailure({
				userId,
				selectedAt: pack.selectedAt,
				at: now,
				outcome: "failed",
			});
			deps.logger.error("[Starter] insertion failed", {
				userId,
				campaignId: pack.campaignId,
				error,
			});
			throw error;
		}
	};
}
