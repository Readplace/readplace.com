type ChargeRoundTrips = <TArgs extends unknown[], TResult>(
	fetchFn: (...args: TArgs) => Promise<TResult>,
) => (...args: TArgs) => Promise<TResult>;

export type VirtualNetwork = {
	chargeRoundTrips: ChargeRoundTrips;
	elapsedMs: () => number;
};

export function initVirtualNetwork(config: {
	roundTripMs: number;
}): VirtualNetwork {
	let elapsed = 0;
	const chargeRoundTrips: ChargeRoundTrips = (fetchFn) => {
		return (...args) => {
			elapsed += config.roundTripMs;
			return fetchFn(...args);
		};
	};
	return { chargeRoundTrips, elapsedMs: () => elapsed };
}
