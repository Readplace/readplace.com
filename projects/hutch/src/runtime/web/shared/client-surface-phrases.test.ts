import assert from "node:assert/strict";
import { SUPPORTED_CLIENTS } from "@packages/supported-clients";
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
		assert.equal(SAVE_SURFACES_PHRASE, "your browser, your iPhone, or your AI assistant");
	});

	it("pins the queue empty-state save-surfaces phrase", () => {
		assert.equal(SAVE_SURFACES_SHORT_PHRASE, "your browser, iPhone, or AI assistant");
	});

	it("pins the home features setup-surfaces phrase", () => {
		assert.equal(SETUP_SURFACES_PHRASE, "in your browser, on your iPhone, or in your AI assistant");
	});

	it("pins the reader-failed full-page-capture phrase", () => {
		assert.equal(FULL_PAGE_CAPTURE_PHRASE, "the browser extension and iPhone app");
	});

	it("never names a single client of a group that has several clients", () => {
		const groups = new Set(SUPPORTED_CLIENTS.map((client) => client.group));
		for (const group of groups) {
			const members = SUPPORTED_CLIENTS.filter((client) => client.group === group);
			if (members.length < 2) continue;
			for (const member of members) {
				for (const phrase of ALL_PHRASES) {
					assert.equal(
						phrase.toLowerCase().includes(member.displayName.toLowerCase()),
						false,
						`"${phrase}" names ${member.displayName}; reword the ${group} phrase to cover all its clients`,
					);
				}
			}
		}
	});
});
