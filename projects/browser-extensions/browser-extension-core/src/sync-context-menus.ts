import "./zod-config";
import { z } from "zod";
import {
	type ContextMenuItem,
	contextMenuItemsFor,
} from "./advertised-capabilities";

export const ADVERTISED_CAPABILITIES_STORAGE_KEY = "hutch_advertised_capabilities";

const StoredCapabilitiesSchema = z.array(z.string());

export function parseStoredCapabilities(raw: unknown): string[] | null {
	const stored = StoredCapabilitiesSchema.safeParse(raw);
	if (!stored.success) return null;
	return stored.data;
}

export interface AdvertisedCapabilityStore {
	read: () => Promise<unknown>;
	write: (capabilities: string[]) => Promise<void>;
}

export function initSyncContextMenus(deps: {
	store: AdvertisedCapabilityStore;
	registerMenus: (items: ContextMenuItem[]) => Promise<void>;
}): {
	applyCached: () => Promise<void>;
	capabilitiesDiscovered: (capabilities: string[]) => Promise<void>;
} {
	let lastRegistered: string | null = null;

	return {
		async applyCached() {
			const capabilities = parseStoredCapabilities(await deps.store.read());
			if (capabilities !== null) lastRegistered = JSON.stringify(capabilities);
			await deps.registerMenus(contextMenuItemsFor(capabilities));
		},

		async capabilitiesDiscovered(capabilities) {
			const discovered = JSON.stringify(capabilities);
			if (discovered === lastRegistered) return;
			lastRegistered = discovered;
			await deps.store.write(capabilities);
			await deps.registerMenus(contextMenuItemsFor(capabilities));
		},
	};
}
