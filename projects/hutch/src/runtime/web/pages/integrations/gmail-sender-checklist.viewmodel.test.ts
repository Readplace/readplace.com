import assert from "node:assert/strict";
import { type ForwardableSender, ForwardableSenderSchema } from "@packages/domain/gmail";
import { type GmailChecklistCommand, type GmailSenderChecklist, toGmailSenderChecklist } from "./gmail-sender-checklist.viewmodel";
import type { GmailSenderCandidate } from "./gmail-sender-picker.viewmodel";
import type { GmailPickerState } from "./gmail.url";

const TLDR = ForwardableSenderSchema.parse("dan@tldr.tech");
const BREW = ForwardableSenderSchema.parse("crew@morningbrew.com");
const BYTES = ForwardableSenderSchema.parse("hello@bytes.dev");
const FRIEND = ForwardableSenderSchema.parse("alex@example.com");
const SHOP = ForwardableSenderSchema.parse("deals@shop.example");

function candidate(email: ForwardableSender, overrides: Partial<GmailSenderCandidate> = {}): GmailSenderCandidate {
	return { email, displayName: undefined, newsletterName: undefined, recognized: false, mapped: false, ...overrides };
}

function candidates(...entries: GmailSenderCandidate[]): Map<ForwardableSender, GmailSenderCandidate> {
	return new Map(entries.map((entry) => [entry.email, entry]));
}

const NO_COMMAND: GmailChecklistCommand = { pick: undefined, select: undefined, dismiss: undefined };

const MAILBOX = candidates(
	candidate(TLDR, { newsletterName: "TLDR", displayName: "Dan", recognized: true }),
	candidate(BREW, { displayName: "Morning Brew Crew", recognized: true }),
	candidate(BYTES, { newsletterName: "Bytes", recognized: true, mapped: true }),
	candidate(FRIEND, { displayName: "Alex" }),
	candidate(SHOP),
);

function checklist(input: { state?: GmailPickerState; command?: GmailChecklistCommand; catalogAvailable?: boolean; candidates?: Map<ForwardableSender, GmailSenderCandidate> }): GmailSenderChecklist {
	return toGmailSenderChecklist({
		state: input.state ?? {},
		candidates: input.candidates ?? MAILBOX,
		catalogAvailable: input.catalogAvailable ?? true,
		command: input.command ?? NO_COMMAND,
	});
}

function rows(vm: GmailSenderChecklist): [string, string, string | undefined, boolean, string][] {
	return vm.groups.flatMap((group) => group.rows.map((row): [string, string, string | undefined, boolean, string] => [
		group.key, row.email, row.name, row.checked, row.fields.map((field) => `${field.name}=${field.value}`).join("&"),
	]));
}

function actions(vm: GmailSenderChecklist): [string, string | undefined, string, string][] {
	return vm.actions.map((action) => [action.key, action.name, action.value, action.label]);
}

describe("Gmail sender checklist groups", () => {
	it("lists the unmapped known newsletters unticked, named by the catalog before the sender's own name", () => {
		const vm = checklist({});
		assert.deepEqual(rows(vm), [
			["known", BREW, "Morning Brew Crew", false, ""],
			["known", TLDR, "TLDR", false, ""],
		]);
		assert.deepEqual(vm.groups.map((group) => group.title), ["Known newsletters"]);
		assert.equal(vm.total, 2);
		assert.equal(vm.knownCount, 2);
		assert.deepEqual(vm.sender, []);
		assert.deepEqual(vm.added, []);
		assert.equal(vm.intro, "These are the known newsletters in your Gmail. Tick the ones to send to your readlists. Looking for a sender that isn't listed? Search all your senders below and it joins this list.");
	});

	it("puts a requested mapped sender under Editing and an unrecognised one under Senders you added with its added field", () => {
		const vm = checklist({ state: { sender: [BYTES, TLDR], added: [SHOP] } });
		assert.deepEqual(rows(vm), [
			["editing", BYTES, "Bytes", true, ""],
			["known", BREW, "Morning Brew Crew", false, ""],
			["known", TLDR, "TLDR", true, ""],
			["added", SHOP, undefined, false, `added=${SHOP}`],
		]);
		assert.deepEqual(vm.groups.map((group) => group.title), ["Editing", "Known newsletters", "Senders you added"]);
		assert.equal(vm.total, 4);
		assert.equal(vm.knownCount, 2);
		assert.deepEqual(vm.sender, [BYTES, TLDR]);
		assert.deepEqual(vm.added, [SHOP]);
	});

	it("adds a picked sender as a ticked row and ticks a picked known newsletter in place", () => {
		const added = checklist({ state: { sender: [TLDR] }, command: { pick: FRIEND, select: undefined, dismiss: undefined } });
		assert.deepEqual(rows(added).filter(([, , , checked]) => checked), [
			["known", TLDR, "TLDR", true, ""],
			["added", FRIEND, "Alex", true, `added=${FRIEND}`],
		]);
		assert.deepEqual(added.sender, [TLDR, FRIEND]);
		const known = checklist({ command: { pick: BREW, select: undefined, dismiss: undefined } });
		assert.deepEqual(known.groups.map((group) => group.key), ["known"]);
		assert.deepEqual(known.sender, [BREW]);
	});

	it("drops a requested sender the mailbox never sent", () => {
		const vm = checklist({ state: { sender: [ForwardableSenderSchema.parse("gone@example.com")], added: [ForwardableSenderSchema.parse("lost@example.com")] } });
		assert.deepEqual(vm.groups.map((group) => group.key), ["known"]);
		assert.deepEqual(vm.sender, []);
		assert.deepEqual(vm.added, []);
	});
});

describe("Gmail sender checklist toggle", () => {
	it("offers Select all until every listed row is ticked, then Clear selection", () => {
		assert.deepEqual(actions(checklist({ state: { sender: [TLDR] } })), [["select", "select", "all", "Select all"]]);
		assert.deepEqual(actions(checklist({ state: { sender: [TLDR, BREW] } })), [["select", "select", "none", "Clear selection"]]);
	});

	it("ticks every listed row on select=all, added rows included", () => {
		const vm = checklist({ state: { added: [SHOP] }, command: { pick: undefined, select: "all", dismiss: undefined } });
		assert.deepEqual(vm.sender, [BREW, TLDR, SHOP]);
		assert.deepEqual(actions(vm), [["select", "select", "none", "Clear selection"]]);
	});

	it("unticks every row on select=none and keeps the added rows listed", () => {
		const vm = checklist({ state: { sender: [TLDR, SHOP], added: [SHOP] }, command: { pick: undefined, select: "none", dismiss: undefined } });
		assert.deepEqual(rows(vm).map(([group, email, , checked]) => [group, email, checked]), [
			["known", BREW, false],
			["known", TLDR, false],
			["added", SHOP, false],
		]);
		assert.deepEqual(vm.sender, []);
		assert.deepEqual(vm.added, [SHOP]);
	});
});

describe("Gmail added sender dismissal", () => {
	it("offers removal only for rows the reader added", () => {
		const vm = checklist({ state: { sender: [BYTES, TLDR, FRIEND], added: [SHOP] } });
		assert.deepEqual(vm.groups.map((group) => [group.key, group.actions]), [
			["editing", []],
			["known", []],
			["added", [{ name: "dismiss", label: "Remove" }]],
		]);
	});

	it.each([true, false])("dismisses a draft row whether checked=%s while preserving the other rows", (checked) => {
		const vm = checklist({
			state: { sender: checked ? [TLDR, FRIEND] : [TLDR], added: [FRIEND, SHOP] },
			command: { ...NO_COMMAND, dismiss: FRIEND },
		});
		assert.deepEqual(rows(vm), [
			["known", BREW, "Morning Brew Crew", false, ""],
			["known", TLDR, "TLDR", true, ""],
			["added", SHOP, undefined, false, `added=${SHOP}`],
		]);
		assert.deepEqual(vm.sender, [TLDR]);
		assert.deepEqual(vm.added, [SHOP]);
		assert.equal(vm.total, 3);
	});

	it.each([TLDR, BYTES, SHOP])("leaves known, mapped, and absent rows alone when asked to dismiss %s", (dismiss) => {
		const state = { sender: [TLDR, BYTES, FRIEND], added: [FRIEND] };
		assert.deepEqual(checklist({ state, command: { ...NO_COMMAND, dismiss } }), checklist({ state }));
	});

	it("removes the added group with its last row and allows the sender to be picked again", () => {
		const removed = checklist({ state: { sender: [FRIEND], added: [FRIEND] }, command: { ...NO_COMMAND, dismiss: FRIEND } });
		assert.deepEqual(removed.groups.map((group) => group.key), ["known"]);
		assert.deepEqual(removed.sender, []);
		assert.deepEqual(removed.added, []);
		const restored = checklist({ state: { sender: removed.sender, added: removed.added }, command: { ...NO_COMMAND, pick: FRIEND } });
		assert.deepEqual(restored.sender, [FRIEND]);
		assert.deepEqual(restored.added, [FRIEND]);
	});
});

describe("Gmail sender checklist states", () => {
	it("lists known newsletters with no message", () => {
		const vm = checklist({});
		assert.equal(vm.state, "listed");
		assert.equal(vm.message, "");
	});

	it("reports no discovered senders and offers no toggle", () => {
		const vm = checklist({ candidates: candidates() });
		assert.equal(vm.state, "no-discovered-senders");
		assert.equal(vm.message, "No senders discovered yet.");
		assert.deepEqual(vm.groups, []);
		assert.deepEqual(actions(vm), []);
	});

	it("offers Try again ahead of the toggle when the catalog is unavailable, keeping the ticked rows", () => {
		const unrecognised = candidates(candidate(FRIEND, { displayName: "Alex" }), candidate(SHOP));
		const vm = checklist({ candidates: unrecognised, catalogAvailable: false, state: { sender: [SHOP], added: [SHOP] } });
		assert.equal(vm.state, "catalog-unavailable");
		assert.equal(vm.message, "Newsletter suggestions are unavailable right now. Try again, or search all your senders below.");
		assert.deepEqual(actions(vm), [["retry", undefined, "", "Try again"], ["select", "select", "none", "Clear selection"]]);
		assert.deepEqual(vm.sender, [SHOP]);
		assert.deepEqual(actions(checklist({ candidates: unrecognised, catalogAvailable: false })), [["retry", undefined, "", "Try again"]]);
	});

	it("says no sender is a known newsletter when none is recognised", () => {
		const vm = checklist({ candidates: candidates(candidate(FRIEND), candidate(SHOP)) });
		assert.equal(vm.state, "no-known-newsletters");
		assert.equal(vm.message, "None of your senders is a known newsletter yet. Search all your senders below to add one.");
		assert.deepEqual(actions(vm), []);
	});

	it("says every known newsletter is already saved when each recognised sender is mapped", () => {
		const vm = checklist({ candidates: candidates(candidate(BYTES, { recognized: true, mapped: true }), candidate(SHOP)) });
		assert.equal(vm.state, "all-known-mapped");
		assert.equal(vm.message, "Every known newsletter in your Gmail is already in your newsletters. Search all your senders below to add another.");
		assert.equal(vm.knownCount, 0);
	});
});
