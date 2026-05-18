/** Consumed only by the production composition root in app.ts. Every other
 * call site receives the limit via the FoundingAllocation bundle so tests can
 * substitute a smaller value without rewriting production code. */
export const PROD_FOUNDING_MEMBER_LIMIT = 100;

export interface FoundingAllocation {
	foundingMemberLimit: number;
	isFoundingAllocationExhausted: (userCount: number) => boolean;
}

export function initFoundingAllocation(deps: {
	foundingMemberLimit: number;
}): FoundingAllocation {
	const { foundingMemberLimit } = deps;
	return {
		foundingMemberLimit,
		isFoundingAllocationExhausted: (userCount) =>
			userCount >= foundingMemberLimit,
	};
}
