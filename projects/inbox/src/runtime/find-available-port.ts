import assert from "node:assert";
import { createServer } from "node:net";

/** Consecutive ports to try before giving up and surfacing the bind failure. */
export const MAX_PORT_ATTEMPTS = 20;

/**
 * The first port at or after `preferredPort` that is free to bind.
 *
 * A second checkout of this repo — or any other process — already holding the
 * preferred port would otherwise leave the dev server dead on arrival, and
 * whoever hit it would have to hand-pick a port. Worse, the failure reads as
 * success: the other checkout keeps answering on that port, so the browser
 * shows a running app that is serving somebody else's code.
 *
 * Stepping to the next port rather than taking an OS-assigned ephemeral one
 * (what the E2E harness does, where supertest is handed the server and never
 * needs the number) keeps the URL stable across the restarts `tsx watch`
 * performs on every save — an ephemeral port would move the app out from under
 * an open browser tab each time a file changed.
 */
export async function findAvailablePort(input: {
	preferredPort: number;
	maxAttempts: number;
}): Promise<number> {
	assert(input.maxAttempts >= 1, "findAvailablePort must be allowed at least one attempt");
	let lastError: unknown;
	for (let offset = 0; offset < input.maxAttempts; offset += 1) {
		const port = input.preferredPort + offset;
		try {
			await bindThenRelease(port);
			return port;
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

/** Bind to prove the port is free, then hand it straight back. The gap between
 * releasing here and the caller binding is the same race the repo's other
 * free-port probe carries; on a dev machine losing it means one more restart. */
function bindThenRelease(port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", reject);
		probe.listen(port, () => {
			probe.close(() => resolve());
		});
	});
}
