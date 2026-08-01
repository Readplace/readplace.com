import { initVirtualNetwork } from "./virtual-network";

describe("initVirtualNetwork", () => {
	it("charges one round trip per request", async () => {
		const network = initVirtualNetwork({ roundTripMs: 100 });
		const request = network.chargeRoundTrips(async (value: string) => value);

		expect(network.elapsedMs()).toBe(0);
		await expect(request("first")).resolves.toBe("first");
		expect(network.elapsedMs()).toBe(100);
	});

	it("accumulates every sequential request", async () => {
		const network = initVirtualNetwork({ roundTripMs: 100 });
		const request = network.chargeRoundTrips(async (value: string) => value);

		await request("first");
		await request("second");
		await request("third");

		expect(network.elapsedMs()).toBe(300);
	});

	it("charges concurrent requests each in full, over-counting relative to wall clock", async () => {
		const network = initVirtualNetwork({ roundTripMs: 100 });
		const request = network.chargeRoundTrips(async (value: string) => value);

		await Promise.all([request("first"), request("second")]);

		expect(network.elapsedMs()).toBe(200);
	});

	it("keeps every network on its own clock", async () => {
		const measured = initVirtualNetwork({ roundTripMs: 100 });
		const untouched = initVirtualNetwork({ roundTripMs: 100 });

		await measured.chargeRoundTrips(async (value: string) => value)("first");

		expect(measured.elapsedMs()).toBe(100);
		expect(untouched.elapsedMs()).toBe(0);
	});
});
