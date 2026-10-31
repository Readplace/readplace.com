import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import { getFreePort } from "./get-free-port";

const HELD_PORTS = 10;
const PROBES_TO_WRAP_THE_MACOS_EPHEMERAL_RANGE = 20_000;

function listenOnLoopback(port: number): Promise<Server> {
	return new Promise((resolve) => {
		const server = createServer((socket) => socket.destroy());
		server.listen(port, "127.0.0.1", () => resolve(server));
	});
}

function portOf(server: Server): number {
	const address = server.address();
	assert(address !== null && typeof address !== "string", "a listening TCP server reports an AddressInfo");
	return address.port;
}

function release(server: Server): Promise<void> {
	return new Promise((resolve) => server.close(() => resolve()));
}

describe("getFreePort", () => {
	it("never returns a port another server holds on 127.0.0.1", async () => {
		const held = await Promise.all(Array.from({ length: HELD_PORTS }, () => listenOnLoopback(0)));
		const heldPorts = new Set(held.map(portOf));
		const returned: number[] = [];
		for (let probe = 0; probe < PROBES_TO_WRAP_THE_MACOS_EPHEMERAL_RANGE; probe++) {
			returned.push(await getFreePort());
		}
		await Promise.all(held.map(release));
		assert.deepEqual(
			returned.filter((port) => heldPorts.has(port)),
			[],
		);
	});

	it("returns a port a server can then listen on at 127.0.0.1", async () => {
		const port = await getFreePort();
		const server = await listenOnLoopback(port);
		assert.equal(portOf(server), port);
		await release(server);
	});
});
