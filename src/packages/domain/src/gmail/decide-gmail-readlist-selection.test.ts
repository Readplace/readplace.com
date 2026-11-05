import assert from "node:assert/strict";
import {
	DEFAULT_READLIST_SLUG,
	ReadlistSlugSchema,
} from "../readlist/readlist-name.schema";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import {
	type GmailSenderRouting,
	decideGmailReadlistSelection,
} from "./decide-gmail-readlist-selection";

const TECH = ReadlistSlugSchema.parse("tech");
const COOKING = ReadlistSlugSchema.parse("cooking");
const READLISTS = [{ slug: TECH }, { slug: COOKING }];

const DIGEST = ForwardableSenderSchema.parse("digest@example.com");
const WEEKLY = ForwardableSenderSchema.parse("weekly@example.com");
const RECIPES = ForwardableSenderSchema.parse("recipes@example.com");

describe("decideGmailReadlistSelection", () => {
	it("refuses the default readlist, which takes every sender with no other destination", () => {
		const decision = decideGmailReadlistSelection({
			slug: DEFAULT_READLIST_SLUG,
			readlists: [{ slug: DEFAULT_READLIST_SLUG }, ...READLISTS],
			ticked: [],
			routed: [],
			known: new Set(),
			routing: new Map(),
		});

		assert.deepEqual(decision, { ok: false, reason: "unknown-readlist" });
	});

	it("refuses a readlist the reader no longer has", () => {
		const decision = decideGmailReadlistSelection({
			slug: ReadlistSlugSchema.parse("deleted"),
			readlists: READLISTS,
			ticked: [],
			routed: [],
			known: new Set(),
			routing: new Map(),
		});

		assert.deepEqual(decision, { ok: false, reason: "unknown-readlist" });
	});

	it("refuses a ticked sender the mailbox never showed", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [],
			known: new Set([WEEKLY]),
			routing: new Map(),
		});

		assert.deepEqual(decision, { ok: false, reason: "sender-unknown" });
	});

	it("refuses a ticked sender whose destination cannot be resolved", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[DIGEST, { kind: "unresolved" }],
			]),
		});

		assert.deepEqual(decision, { ok: false, reason: "sender-unresolved" });
	});

	it("forwards a sender with no mapping here as the issue itself, new to the filter", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [],
			known: new Set([DIGEST]),
			routing: new Map(),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [TECH],
					deliveryMode: "issue",
					newToFilter: true,
				},
			],
		});
	});

	it("forwards a sender seen but never mapped with the mode the picker offers it", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[DIGEST, { kind: "unmapped", deliveryMode: "issue" }],
			]),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [TECH],
					deliveryMode: "issue",
					newToFilter: true,
				},
			],
		});
	});

	it("forwards a mapped sender not yet in the filter with its mode, new to the filter", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[DIGEST, { kind: "unrouted", deliveryMode: "both" }],
			]),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [TECH],
					deliveryMode: "both",
					newToFilter: true,
				},
			],
		});
	});

	it("adds this readlist alongside the sender's other readlists and keeps its mode", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[
					DIGEST,
					{ kind: "routed", readlists: [COOKING], deliveryMode: "links" },
				],
			]),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [COOKING, TECH],
					deliveryMode: "links",
					newToFilter: false,
				},
			],
		});
	});

	it("removes only this readlist when a sender is unticked, keeping the others", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [],
			routed: [DIGEST],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[
					DIGEST,
					{ kind: "routed", readlists: [COOKING, TECH], deliveryMode: "both" },
				],
			]),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [COOKING],
					deliveryMode: "both",
					newToFilter: false,
				},
			],
		});
	});

	it("leaves an unticked sender with no readlists when this was its only one, so it goes to All", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [],
			routed: [DIGEST],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[DIGEST, { kind: "routed", readlists: [TECH], deliveryMode: "issue" }],
			]),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [],
					deliveryMode: "issue",
					newToFilter: false,
				},
			],
		});
	});

	it("skips a sender the form showed as routed here that has since moved elsewhere", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [],
			routed: [DIGEST, WEEKLY],
			known: new Set([DIGEST, WEEKLY]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[
					DIGEST,
					{ kind: "routed", readlists: [COOKING], deliveryMode: "issue" },
				],
				[WEEKLY, { kind: "unrouted", deliveryMode: "issue" }],
			]),
		});

		assert.deepEqual(decision, { ok: true, changes: [] });
	});

	it("never removes a sender routed here that the form did not show", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [],
			routed: [],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[DIGEST, { kind: "routed", readlists: [TECH], deliveryMode: "issue" }],
			]),
		});

		assert.deepEqual(decision, { ok: true, changes: [] });
	});

	it("changes nothing when every ticked sender is already routed here", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [DIGEST],
			routed: [DIGEST],
			known: new Set([DIGEST]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[DIGEST, { kind: "routed", readlists: [TECH], deliveryMode: "issue" }],
			]),
		});

		assert.deepEqual(decision, { ok: true, changes: [] });
	});

	it("decides each repeated sender once, additions by email before removals", () => {
		const decision = decideGmailReadlistSelection({
			slug: TECH,
			readlists: READLISTS,
			ticked: [WEEKLY, DIGEST, WEEKLY],
			routed: [RECIPES, RECIPES],
			known: new Set([DIGEST, WEEKLY, RECIPES]),
			routing: new Map<typeof DIGEST, GmailSenderRouting>([
				[RECIPES, { kind: "routed", readlists: [TECH], deliveryMode: "links" }],
			]),
		});

		assert.deepEqual(decision, {
			ok: true,
			changes: [
				{
					sender: DIGEST,
					readlists: [TECH],
					deliveryMode: "issue",
					newToFilter: true,
				},
				{
					sender: WEEKLY,
					readlists: [TECH],
					deliveryMode: "issue",
					newToFilter: true,
				},
				{
					sender: RECIPES,
					readlists: [],
					deliveryMode: "links",
					newToFilter: false,
				},
			],
		});
	});
});
