import assert from "node:assert";
import { Agent, buildConnector, type Dispatcher } from "undici";
import {
	type AssertHostAllowed,
	createBlockedAddressLookup,
	createLiteralHostGuard,
	type IsBlockedAddress,
	type ResolveAll,
	type SocketLookup,
} from "./blocked-address-lookup";

export function createGuardedDispatcher(deps: { resolve: ResolveAll; isBlocked: IsBlockedAddress }): {
	dispatcher: Dispatcher;
	lookup: SocketLookup;
	assertHostAllowed: AssertHostAllowed;
} {
	const lookup = createBlockedAddressLookup(deps);
	const assertHostAllowed = createLiteralHostGuard({ isBlocked: deps.isBlocked });
	const baseConnector = buildConnector({ lookup });
	const dispatcher = new Agent({
		connect(options, callback) {
			try {
				assertHostAllowed(options.hostname);
			} catch (error) {
				assert(error instanceof Error, "createLiteralHostGuard only throws Error");
				callback(error, null);
				return;
			}
			baseConnector(options, callback);
		},
	});
	return { dispatcher, lookup, assertHostAllowed };
}
