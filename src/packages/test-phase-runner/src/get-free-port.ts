import assert from "node:assert";
import { createServer } from "node:net";

export function getFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, () => {
			const address = server.address();
			// listen(0) on a TCP server always yields an AddressInfo; assert rather
			// than branch on the impossible pipe-string/null case so coverage stays
			// exact (the guard lives inside node:assert, not this function).
			assert(address, "server.address() must be set after listen(0)");
			assert(typeof address !== "string", "server.address() must be AddressInfo, not a pipe path");
			server.close(() => resolve(address.port));
		});
	});
}
