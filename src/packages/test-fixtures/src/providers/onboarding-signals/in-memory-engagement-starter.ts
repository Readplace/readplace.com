import { randomUUID } from "node:crypto";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import type {
	EngagementStarterState,
	EngagementState,
	SaveStarterPack,
	StarterPack,
} from "@packages/provider-contracts/engagement-starter";

export function initInMemoryEngagementStarter(deps: {
	library: { saveStarterPack: SaveStarterPack };
}): EngagementStarterState & {
	saveStarterPack: SaveStarterPack;
	deleteEngagement: (userId: UserId) => void;
} {
	const states = new Map<UserId, EngagementState>();
	const packs = new Map<UserId, StarterPack>();
	const find = (userId: UserId) => states.get(userId) ?? { activityRevision: 0 };
	return {
		listStarterObservations: async (campaignId) =>
			[...states]
				.filter(([, engagement]) => engagement.assignment?.campaignId === campaignId)
				.map(([userId, engagement]) => ({
					userId,
					engagement,
					starterPack: packs.get(userId),
				})),
		findEngagement: async (userId) => find(userId),
		withdrawStarterAssignment: async (userId) => {
			const state = states.get(userId);
			if (state?.assignment === undefined) return;
			const anonymousId = UserIdSchema.parse(randomUUID());
			const {
				observationStartedAt: _observationStartedAt,
				lastActivityAt: _lastActivityAt,
				activityRevision: _activityRevision,
				...outcome
			} = state;
			states.set(anonymousId, { ...outcome, activityRevision: 0 });
			const pack = packs.get(userId);
			if (pack !== undefined) {
				const { message: _message, ...withoutMessage } = pack;
				packs.set(anonymousId, { ...withoutMessage, picks: [] });
			}
			states.delete(userId);
		},
		observeEngagement: async ({ userId, startedAt }) => {
			const state = find(userId);
			const observed = {
				...state,
				observationStartedAt: state.observationStartedAt ?? startedAt,
				activityRevision: state.activityRevision + 1,
			};
			states.set(userId, observed);
			return observed;
		},
		recordEngagementActivity: async (input) => {
			const state = find(input.userId);
			const at = input.at.toISOString();
			const days =
				state.assignment === undefined
					? -1
					: (input.at.getTime() - Date.parse(state.assignment.assignedAt)) / 86_400_000;
			const primary =
				input.kind === "personal-save" ||
				input.kind === "mcp-content" ||
				input.kind === "mcp-summary" ||
				(input.kind === "read-status" && input.markedRead === true);
			states.set(input.userId, {
				...state,
				activityRevision: state.activityRevision + 1,
				lastActivityAt:
					state.lastActivityAt === undefined || at > state.lastActivityAt
						? at
						: state.lastActivityAt,
				...(primary && days >= 0 && days < 7 && state.activatedAt === undefined
					? { activatedAt: at }
					: {}),
				...(days >= 7 && days < 14 && state.engagedDays8To14At === undefined
					? { engagedDays8To14At: at }
					: {}),
			});
		},
		assignStarter: async ({ userId, revision, assignment, pack }) => {
			const state = find(userId);
			if (state.assignment !== undefined || state.activityRevision !== revision) return "conflict";
			states.set(userId, { ...state, assignment, activityRevision: revision + 1 });
			if (assignment.arm === "treatment") packs.set(userId, pack);
			return "assigned";
		},
		findStarterPack: async (userId) => packs.get(userId),
		replaceStarterSelection: async ({ userId, selectedAt, pack }) => {
			const prior = packs.get(userId);
			if (
				prior?.selectedAt !== selectedAt ||
				prior.insertedAt !== undefined ||
				prior.emailStatus !== "pending"
			) {
				return "conflict";
			}
			packs.set(userId, pack);
			return "replaced";
		},
		recordStarterInsertionFailure: async ({ userId, selectedAt, at, outcome }) => {
			const pack = packs.get(userId);
			if (pack?.selectedAt === selectedAt && pack.insertedAt === undefined) {
				packs.set(userId, {
					...pack,
					insertionOutcome: outcome,
					lastInsertionAttemptAt: at.toISOString(),
				});
			}
		},
		saveStarterPack: async (input) => {
			const { assignment, activityRevision } = find(input.userId);
			const prior = packs.get(input.userId);
			if (
				activityRevision !== input.activityRevision ||
				assignment?.arm !== "treatment" ||
				assignment.campaignId !== input.pack.campaignId ||
				prior?.campaignId !== input.pack.campaignId ||
				prior.selectedAt !== input.pack.selectedAt ||
				prior.insertedAt !== undefined ||
				prior.emailStatus !== "pending"
			) {
				return "conflict";
			}
			const outcome = await deps.library.saveStarterPack(input);
			if (outcome === "inserted") {
				packs.set(input.userId, {
					...input.pack,
					insertedAt: input.at.toISOString(),
					insertionOutcome: "inserted",
					lastInsertionAttemptAt: input.at.toISOString(),
				});
			}
			return outcome;
		},
		claimStarterEmail: async ({ userId, message, at, itemCount }) => {
			const pack = packs.get(userId);
			if (
				pack === undefined ||
				(pack.emailStatus !== "pending" && pack.emailStatus !== "sending")
			) {
				return undefined;
			}
			if (pack.message !== undefined) return pack;
			const claimed = {
				...pack,
				message,
				emailStatus: "sending" as const,
				firstAttemptAt: at.toISOString(),
				itemCount,
			};
			packs.set(userId, claimed);
			return claimed;
		},
		suppressStarterEmail: async ({ userId, reason }) => {
			const pack = packs.get(userId);
			if (pack?.emailStatus !== "pending") return false;
			packs.set(userId, { ...pack, reason, emailStatus: "suppressed" });
			return true;
		},
		markStarterEmailSent: async ({ userId, at }) => {
			const pack = packs.get(userId);
			if (pack?.emailStatus !== "sending") return false;
			packs.set(userId, { ...pack, sentAt: at.toISOString(), emailStatus: "sent" });
			return true;
		},
		markStarterEmailReview: async ({ userId, reason }) => {
			const pack = packs.get(userId);
			if (pack?.emailStatus !== "sending") return false;
			packs.set(userId, { ...pack, reason, emailStatus: "review" });
			return true;
		},
		deleteEngagement: (userId) => {
			states.delete(userId);
			packs.delete(userId);
		},
	};
}
