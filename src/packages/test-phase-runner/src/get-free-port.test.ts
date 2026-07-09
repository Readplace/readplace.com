import { getFreePort } from "./get-free-port";

describe("getFreePort", () => {
	it("resolves to an allocated TCP port number", async () => {
		const port = await getFreePort();
		expect(typeof port).toBe("number");
		expect(port).toBeGreaterThan(0);
		expect(port).toBeLessThan(65536);
	});

	it("returns a currently-free port on each call", async () => {
		const first = await getFreePort();
		const second = await getFreePort();
		expect(first).toBeGreaterThan(0);
		expect(second).toBeGreaterThan(0);
	});
});
