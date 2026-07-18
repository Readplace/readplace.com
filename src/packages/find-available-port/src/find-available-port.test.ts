import { createServer, type Server } from "node:net";
import { MAX_PORT_ATTEMPTS, findAvailablePort } from "./find-available-port";

function occupy(port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(port, () => resolve(server));
	});
}

function release(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

async function freePort(): Promise<number> {
	const server = await occupy(0);
	const address = server.address();
	// listen(0) on a TCP server always yields an AddressInfo; assert rather than
	// branch on the impossible pipe-string/null case.
	if (address === null || typeof address === "string") {
		throw new Error("expected an AddressInfo from listen(0)");
	}
	await release(server);
	return address.port;
}

describe("findAvailablePort", () => {
	it("takes the preferred port when nothing holds it", async () => {
		const preferredPort = await freePort();

		const port = await findAvailablePort({ preferredPort, maxAttempts: MAX_PORT_ATTEMPTS });

		expect(port).toBe(preferredPort);
	});

	it("steps past a port another process already holds", async () => {
		const preferredPort = await freePort();
		const occupied = await occupy(preferredPort);

		try {
			// The next port up, not an ephemeral one: a second checkout's dev server
			// lands somewhere predictable and stays there across watch restarts.
			const port = await findAvailablePort({ preferredPort, maxAttempts: MAX_PORT_ATTEMPTS });

			expect(port).toBe(preferredPort + 1);
		} finally {
			await release(occupied);
		}
	});

	it("surfaces the bind failure once every attempt is spent", async () => {
		const preferredPort = await freePort();
		const occupied = await occupy(preferredPort);

		try {
			await expect(
				findAvailablePort({ preferredPort, maxAttempts: 1 }),
			).rejects.toMatchObject({ code: "EADDRINUSE" });
		} finally {
			await release(occupied);
		}
	});

	it("refuses a budget that allows no attempt at all, rather than throwing undefined", async () => {
		await expect(findAvailablePort({ preferredPort: 3300, maxAttempts: 0 })).rejects.toThrow(
			/at least one attempt/,
		);
	});
});
