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
