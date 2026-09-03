import assert from "node:assert/strict";
import { ADVERTISED_CLIENTS } from "@packages/supported-clients";
import {
	FULL_PAGE_CAPTURE_PHRASE,
	SAVE_SURFACES_PHRASE,
	SAVE_SURFACES_SHORT_PHRASE,
	SETUP_SURFACES_PHRASE,
} from "./client-surface-phrases";

const ALL_PHRASES = [
	SAVE_SURFACES_PHRASE,
	SAVE_SURFACES_SHORT_PHRASE,
	SETUP_SURFACES_PHRASE,
	FULL_PAGE_CAPTURE_PHRASE,
];

describe("client surface phrases", () => {
	it("pins the welcome-email save-surfaces phrase", () => {
		assert.equal(SAVE_SURFACES_PHRASE, "your browser, your phone, or your AI assistant");
	});

	it("pins the queue empty-state save-surfaces phrase", () => {
		assert.equal(SAVE_SURFACES_SHORT_PHRASE, "your browser, phone, or AI assistant");
	});

	it("pins the home features setup-surfaces phrase", () => {
		assert.equal(SETUP_SURFACES_PHRASE, "in your browser, on your phone, or in your AI assistant");
	});

	it("pins the reader-failed full-page-capture phrase", () => {
		assert.equal(FULL_PAGE_CAPTURE_PHRASE, "the browser extension and the iPhone app");
	});

	it("never names a strict subset of a group's advertised clients", () => {
		const groups = new Set(ADVERTISED_CLIENTS.map((client) => client.group));
		for (const group of groups) {
			const members = ADVERTISED_CLIENTS.filter((client) => client.group === group);
			for (const phrase of ALL_PHRASES) {
				const named = members.filter((member) =>
					phrase.toLowerCase().includes(member.displayName.toLowerCase()),
				);
				assert.equal(
					named.length === 0 || named.length === members.length,
					true,
					`"${phrase}" names ${named.map((member) => member.displayName).join(", ")} but not the rest of the ${group} group`,
				);
			}
		}
	});
});
