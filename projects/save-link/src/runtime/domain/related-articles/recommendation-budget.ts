import type { UserId } from "@packages/domain/user";

export const RECOMMENDATION_DAILY_LIMIT_NANODOLLARS = 500_000_000;
export const RECOMMENDATION_BUDGET_WINDOW_SECONDS = 86_400;

export interface BudgetWindow {
	startsAt: Date;
	resetsAt: Date;
	startSeconds: number;
}

export interface BudgetReservation {
	id: string;
	userId: UserId;
	windowStartSeconds: number;
	nanodollars: number;
}

export type ReserveRecommendationBudget = (input: {
	userId: UserId;
	reservations: readonly { id: string; nanodollars: number }[];
}) => Promise<
	| { allowed: true; window: BudgetWindow; reservations: BudgetReservation[] }
	| { allowed: false; window: BudgetWindow; consumedNanodollars: number }
>;

export type SettleRecommendationBudget = (input: {
	reservation: BudgetReservation;
	actualNanodollars: number;
}) => Promise<void>;

export type ReleaseRecommendationBudget = (input: {
	reservation: BudgetReservation;
}) => Promise<void>;

export interface RecommendationBudget {
	reserveRecommendationBudget: ReserveRecommendationBudget;
	settleRecommendationBudget: SettleRecommendationBudget;
	releaseRecommendationBudget: ReleaseRecommendationBudget;
}
