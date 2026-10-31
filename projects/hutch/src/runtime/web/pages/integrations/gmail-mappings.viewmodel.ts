import assert from "node:assert";
import type {
	ForwardableSender,
	GmailConnection,
	GmailDeliveryMode,
	GmailFilterError,
	GmailHistoryImportCounts,
	GmailHistoryImportFailureReason,
	GmailHistoryImportJob,
	GmailHistoryImportSummary,
	GmailMapping,
	GmailMarkBackfillCounts,
	GmailMarkBackfillFailureReason,
	GmailMarkBackfillJob,
} from "@packages/domain/gmail";
import {
	GMAIL_HISTORY_IMPORT_MAX_POLLS,
	GMAIL_IMPORTED_LABEL_NAME,
	resolveGmailDeliveryMode,
	summarizeGmailHistoryImport,
} from "@packages/domain/gmail";
import { type InboxAddressEntry, isLiveAddress } from "@packages/domain/inbox";
import { DEFAULT_READLIST, DEFAULT_READLIST_SLUG, type ReadlistRef } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import { buildReadlistUrl } from "../readlist/readlist.url";
import { type GmailConnectionPrompt, gmailConnectionPrompt } from "./gmail-connection-prompt";
import { GMAIL_DELIVERY_COPY } from "./gmail-delivery-copy";
import { type FormField, type GmailFormAction, gmailBodyFields, gmailGetFields, gmailLinkFields, trackGmail } from "./gmail-form-fields";
import { importFollowsMapping, latestGmailImportsBySender } from "./gmail-import-actions";
import type { GmailSenderCandidate } from "./gmail-sender-picker.viewmodel";
import {
	buildGmailUrl,
	closeGmailDialog,
	GMAIL_FILTER_RETRY_PATH,
	GMAIL_IMPORT_CANCEL_PATH,
	GMAIL_IMPORT_RETRY_PATH,
	GMAIL_IMPORT_START_PATH,
	GMAIL_MARK_BACKFILL_PATH,
	GMAIL_MARK_START_PATH,
	GMAIL_MARK_STOP_PATH,
	GMAIL_PATH,
	GMAIL_SENDER_REMOVE_PATH,
	type GmailPickerState,
} from "./gmail.url";

export type GmailMappingDestination =
	| { kind: "readlist"; readlists: readonly ReadlistRef[] }
	| { kind: "unresolved"; reason: "missing" | "disabled" | "legacy" };

export type GmailForwardingState = "pending" | "live" | "failed" | "confirmation-required";

export type GmailImportState = GmailHistoryImportSummary["status"] | "none";

export interface GmailImportCount {
	key: "imported" | "already-imported" | "skipped-no-message-id" | "skipped-sender-mismatch" | "failed" | "cancelled";
	label: string;
}

export type GmailMarkState = "off" | "on" | "permission-lost";

export const GMAIL_MARK_OPTION_LABEL = `Mark imported emails as read and label them ${GMAIL_IMPORTED_LABEL_NAME}`;

export type GmailMarkBackfillState = "offer" | "running" | "done" | "failed";

export interface GmailMarkBackfillCount {
	key: "marked" | "not-found" | "not-saved" | "failed";
	label: string;
}

export interface GmailMarkBackfillViewModel {
	state: GmailMarkBackfillState;
	message: string;
	counts: GmailMarkBackfillCount[];
	actions: GmailFormAction[];
}

export interface GmailMarkViewModel {
	state: GmailMarkState;
	key: "mark-read-start" | "mark-read-stop";
	action: string;
	fields: FormField[];
	label: string;
	checked: boolean;
	disabled: boolean;
	hint: string | undefined;
	prompt: GmailFormAction[];
	backfill: GmailMarkBackfillViewModel | undefined;
}

export interface GmailMappingRow {
	sender: ForwardableSender;
	newsletterName: string | undefined;
	destinationKind: GmailMappingDestination["kind"];
	destinationLabel: string | undefined;
	destinationLinks: readonly { label: string; href: string }[];
	destinationNote: string | undefined;
	deliveryMode: GmailDeliveryMode;
	deliveryLabel: string;
	forwarding: GmailForwardingState;
	forwardingLabel: string;
	importState: GmailImportState;
	importMessage: string;
	importCounts: GmailImportCount[];
	consent: GmailConnectionPrompt | undefined;
	mark: GmailMarkViewModel | undefined;
	actions: GmailFormAction[];
}

type GmailFilterState = "reconnect" | "waiting-confirmation" | "failed" | "updating" | "live" | "none";

export interface GmailFilterViewModel {
	state: GmailFilterState;
	message: string;
	presentation: "alert" | "copy";
	actions: GmailFormAction[];
}

export interface GmailAddNewslettersAction {
	method: "GET";
	action: string;
	label: string;
	variant: "primary" | "neutral";
	fields: FormField[];
}

export interface GmailMappingsViewModel {
	rows: GmailMappingRow[];
	hasRows: boolean;
	headerActions: GmailAddNewslettersAction[];
	emptyActions: GmailAddNewslettersAction[];
	polling: boolean;
	pollUrl: string | undefined;
	exhausted: boolean;
	filter: GmailFilterViewModel;
}

export interface GmailMappingsInput {
	userId: UserId;
	canConnectGmail: boolean;
	connection: GmailConnection;
	senders: readonly GmailMapping[];
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
	candidates: ReadonlyMap<ForwardableSender, GmailSenderCandidate>;
	imports: readonly GmailHistoryImportJob[];
	backfills: readonly GmailMarkBackfillJob[];
	readScopeGranted: boolean;
	modifyScopeGranted: boolean;
	metadataScopeGranted: boolean;
	readlistChoiceShown: boolean;
	state: GmailPickerState;
	importsPollCount: number;
	discoveryStarted: boolean;
	addVariant: GmailAddNewslettersAction["variant"];
}

const FORWARDING_LABELS: Record<GmailForwardingState, string> = {
	pending: "Waiting for Gmail",
	live: "Forwarding",
	failed: "Not forwarding",
	"confirmation-required": "Waiting for forwarding confirmation",
};

type UnresolvedReason = Extract<GmailMappingDestination, { kind: "unresolved" }>["reason"];

const UNRESOLVED_REASONS: Record<UnresolvedReason, string> = {
	legacy: "No readlist yet.",
	missing: "Its destination no longer exists.",
	disabled: "Its destination was switched off.",
};

function unresolvedNote(input: { reason: UnresolvedReason; readlistChoiceShown: boolean }): string {
	const remedy = input.readlistChoiceShown ? "Edit it to choose a readlist." : "Reconnect Gmail to choose one.";
	return `${UNRESOLVED_REASONS[input.reason]} ${remedy}`;
}

const FAILURE_MESSAGES: Record<GmailHistoryImportFailureReason, string> = {
	"gmail-rejected": "Gmail refused the import.",
	"permission-revoked": "Readplace lost permission to read your Gmail messages.",
	"dead-lettered": "The import stopped after repeated errors.",
};

function inboxNote(counts: GmailHistoryImportCounts): string {
	return counts.imported + counts.alreadyImported > 0
		? " The imported emails are in your Inbox; their article links may still be processing."
		: "";
}

function importMessage(summary: GmailHistoryImportSummary | undefined): string {
	if (summary === undefined) return "";
	switch (summary.status) {
		case "awaiting-permission": return "Waiting for permission to read your Gmail messages.";
		case "queued": return "Import queued.";
		case "running": return "Importing unread messages from the last 30 days…";
		case "no-unread": return "No unread messages from the last 30 days.";
		case "complete": return `Import complete.${inboxNote(summary.counts)}`;
		case "partial-failure": return `Import finished, but some messages failed.${inboxNote(summary.counts)}`;
		case "failed": return FAILURE_MESSAGES[summary.reason];
		case "cancelled":
			assert(summary.reason === "user-cancelled", "only the reader's own cancel leaves a stopped import on its current mapping");
			return "Import cancelled.";
	}
}

const SETTLED_COUNTS: readonly [GmailImportCount["key"], Exclude<keyof GmailHistoryImportCounts, "listed">, string][] = [
	["imported", "imported", "imported"],
	["already-imported", "alreadyImported", "already imported"],
	["skipped-no-message-id", "skippedNoMessageId", "skipped (no message ID)"],
	["skipped-sender-mismatch", "skippedSenderMismatch", "skipped (different sender)"],
	["failed", "failed", "failed"],
];

function importCounts(summary: GmailHistoryImportSummary | undefined): GmailImportCount[] {
	if (summary === undefined || !("counts" in summary)) return [];
	const shown = summary.status === "cancelled"
		? [...SETTLED_COUNTS, ["cancelled", "cancelled", "cancelled"] as const]
		: SETTLED_COUNTS;
	return shown.map(([key, field, label]) => ({ key, label: `${summary.counts[field].toLocaleString("en")} ${label}` }));
}

function resolveEntry(entry: InboxAddressEntry, readlists: readonly ReadlistRef[]): ReadlistRef {
	const slug = entry.readlist ?? DEFAULT_READLIST_SLUG;
	return readlists.find((readlist) => readlist.slug === slug) ?? DEFAULT_READLIST;
}

export function gmailMappingDestination(input: {
	sender: GmailMapping;
	userId: UserId;
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
}): GmailMappingDestination {
	if (input.sender.mappedAddresses === undefined) return { kind: "unresolved", reason: "legacy" };
	const selected = [DEFAULT_READLIST];
	for (const address of input.sender.mappedAddresses) {
		const entry = input.destinations.get(address);
		if (entry === undefined || entry.userId !== input.userId) return { kind: "unresolved", reason: "missing" };
		if (!isLiveAddress(entry)) return { kind: "unresolved", reason: "disabled" };
		const readlist = resolveEntry(entry, input.readlists);
		if (!selected.some((current) => current.slug === readlist.slug)) selected.push(readlist);
	}
	return { kind: "readlist", readlists: selected };
}

function forwardingPending(connection: GmailConnection, sender: GmailMapping): boolean {
	const filterUpdatedAt = connection.filterUpdatedAt;
	return filterUpdatedAt === undefined
		|| (sender.addedToFilterAt !== undefined && sender.addedToFilterAt > filterUpdatedAt)
		|| (sender.mappedAt !== undefined && sender.mappedAt > filterUpdatedAt);
}

function forwardingState(input: { connection: GmailConnection; destination: GmailMappingDestination; pending: boolean }): GmailForwardingState {
	const { connection, pending } = input;
	if (input.destination.kind === "unresolved") return "failed";
	if (connection.revokedAt !== undefined || connection.lastFilterError !== undefined) return "failed";
	if (connection.forwardingConfirmedAt === undefined) return "confirmation-required";
	return pending ? "pending" : "live";
}

function postAction(input: {
	key: string;
	content: string;
	path: string;
	label: string;
	variant: GmailFormAction["variant"];
	fields: FormField[];
}): GmailFormAction {
	return {
		key: input.key,
		method: "POST",
		action: trackGmail(input.path, input.content),
		label: input.label,
		variant: input.variant,
		fields: input.fields,
	};
}

const RESTARTABLE: ReadonlySet<GmailImportState> = new Set(["awaiting-permission", "failed", "partial-failure"]);
const UNFINISHED: ReadonlySet<GmailImportState> = new Set(["awaiting-permission", "queued", "running"]);
const STARTABLE: ReadonlySet<GmailImportState> = new Set(["none", "no-unread", "complete", "cancelled"]);

function rowActions(input: {
	sender: GmailMapping;
	destination: GmailMappingDestination;
	importable: boolean;
	importState: GmailImportState;
	job: GmailHistoryImportJob | undefined;
	readScopeGranted: boolean;
	readlistChoiceShown: boolean;
	state: GmailPickerState;
}): GmailFormAction[] {
	const { sender: _picked, ...listState } = closeGmailDialog(input.state);
	const senderFields = [...gmailBodyFields(listState), { name: "sender", value: input.sender.senderEmail }];
	const jobFields = (job: GmailHistoryImportJob) => [...gmailBodyFields(closeGmailDialog(input.state)), { name: "job", value: job.jobId }];
	const editState: GmailPickerState = {
		...listState,
		sender: [input.sender.senderEmail],
		readlist: input.destination.kind === "readlist" ? input.destination.readlists.map((readlist) => readlist.slug) : undefined,
		delivery: undefined,
		edit: "1",
	};
	const actions: GmailFormAction[] = [];
	if (input.readlistChoiceShown) {
		actions.push({
			key: "edit",
			method: "GET",
			action: buildGmailUrl(),
			label: "Edit",
			variant: "neutral",
			fields: gmailGetFields(editState, "edit-mapping"),
			opener: input.sender.senderEmail,
		});
	}
	if (input.importable && STARTABLE.has(input.importState)) {
		actions.push(postAction({ key: "start-import", content: "start-import", path: GMAIL_IMPORT_START_PATH, label: "Import unread messages", variant: "neutral", fields: senderFields }));
	}
	if (input.importable && input.readScopeGranted && input.job !== undefined && RESTARTABLE.has(input.importState)) {
		actions.push(postAction({ key: "retry-import", content: "retry-import", path: GMAIL_IMPORT_RETRY_PATH, label: "Retry import", variant: "neutral", fields: jobFields(input.job) }));
	}
	if (input.job !== undefined && UNFINISHED.has(input.importState)) {
		actions.push(postAction({ key: "cancel-import", content: "cancel-import", path: GMAIL_IMPORT_CANCEL_PATH, label: "Cancel import", variant: "neutral", fields: jobFields(input.job) }));
	}
	actions.push(postAction({ key: "remove", content: "remove-mapping", path: GMAIL_SENDER_REMOVE_PATH, label: "Remove", variant: "secondary", fields: senderFields }));
	return actions;
}

function consentFor(input: {
	sender: ForwardableSender;
	canConnectGmail: boolean;
	importable: boolean;
	importState: GmailImportState;
	readScopeGranted: boolean;
	markOn: boolean;
	state: GmailPickerState;
}): GmailMappingRow["consent"] {
	if (!input.importable || input.readScopeGranted || !RESTARTABLE.has(input.importState)) return undefined;
	const { sender: _picked, ...listState } = closeGmailDialog(input.state);
	return gmailConnectionPrompt({
		canConnectGmail: input.canConnectGmail,
		message: input.markOn
			? "To import unread messages, Readplace needs permission to read your Gmail messages. It reads only mail from this sender."
			: "To import unread messages, Readplace needs permission to read your Gmail messages. It reads only mail from this sender and leaves it unread.",
		content: "grant-import-permission",
		label: "Grant permission",
		variant: "neutral",
		fields: [...gmailBodyFields(listState), { name: "intent", value: "import" }, { name: "sender", value: input.sender }],
	});
}

const MARK_BACKFILL_OFFER = "Mark emails from this sender that Readplace already saved. Emails from before Oct 4, 2026, and whole issues saved before Oct 13, 2026, stay as they are.";

const MARK_BACKFILL_FAILURES: Record<GmailMarkBackfillFailureReason, string> = {
	"permission-revoked": "Readplace lost permission to change your Gmail messages, so earlier emails weren't all updated.",
	"gmail-rejected": "Gmail refused to update earlier emails.",
	"dead-lettered": "Updating earlier emails stopped after repeated errors.",
};

function markBackfillCounts(counts: GmailMarkBackfillCounts): GmailMarkBackfillCount[] {
	const notSaved = counts.notSaved;
	const lines: [GmailMarkBackfillCount["key"], number, string][] = [
		["marked", counts.marked + counts.alreadyMarked, "marked as read"],
		["not-found", counts.notFound + counts.unlocatable, "not found in Gmail"],
		["not-saved", notSaved, notSaved === 1 ? "not fully saved to Readplace, left as it is" : "not fully saved to Readplace, left as they are"],
		["failed", counts.failed, "couldn't be updated"],
	];
	return lines.filter(([, count]) => count > 0).map(([key, count, label]) => ({ key, label: `${count.toLocaleString("en")} ${label}` }));
}

function markBackfill(input: {
	job: GmailMarkBackfillJob | undefined;
	revoked: boolean;
	senderFields: FormField[];
}): GmailMarkBackfillViewModel {
	const { job } = input;
	const apply = (action: { content: string; label: string }): GmailFormAction[] => input.revoked
		? []
		: [postAction({ key: action.content, content: action.content, path: GMAIL_MARK_BACKFILL_PATH, label: action.label, variant: "neutral", fields: input.senderFields })];
	if (job === undefined || job.state === "cancelled") {
		return { state: "offer", message: MARK_BACKFILL_OFFER, counts: [], actions: apply({ content: "mark-read-backfill", label: "Apply to earlier emails" }) };
	}
	const counts = markBackfillCounts(job.counts);
	switch (job.state) {
		case "queued":
		case "running":
			return { state: "running", message: "Updating earlier emails in Gmail…", counts, actions: [] };
		case "complete":
			return counts.length === 0
				? { state: "done", message: "No earlier emails from this sender to update.", counts, actions: [] }
				: { state: "done", message: "Earlier emails updated in Gmail.", counts, actions: [] };
		case "failed":
			assert(job.failureReason, "a failed backfill records why it failed");
			return { state: "failed", message: MARK_BACKFILL_FAILURES[job.failureReason], counts, actions: apply({ content: "mark-read-retry", label: "Try again" }) };
	}
}

const PERMISSION_LOST_MESSAGE = "Readplace lost permission to change your Gmail messages, so imported emails stay unread until you allow it again.";

function markState(input: { checked: boolean; modifyScopeGranted: boolean }): GmailMarkState {
	if (!input.checked) return "off";
	return input.modifyScopeGranted ? "on" : "permission-lost";
}

function markFor(input: {
	sender: GmailMapping;
	destination: GmailMappingDestination;
	connection: GmailConnection;
	canConnectGmail: boolean;
	modifyScopeGranted: boolean;
	metadataScopeGranted: boolean;
	backfills: readonly GmailMarkBackfillJob[];
	state: GmailPickerState;
}): GmailMarkViewModel | undefined {
	const optionEnabledAt = input.sender.markImportedAt;
	const checked = optionEnabledAt !== undefined;
	if (input.destination.kind !== "readlist" && !checked) return undefined;
	const { sender: _picked, ...listState } = closeGmailDialog(input.state);
	const senderFields = [...gmailBodyFields(listState), { name: "sender", value: input.sender.senderEmail }];
	const revoked = input.connection.revokedAt !== undefined;
	const state = markState({ checked, modifyScopeGranted: input.modifyScopeGranted });
	const unavailable = !input.modifyScopeGranted && !input.canConnectGmail;
	const consent = state === "permission-lost" || (state === "off" && unavailable)
		? gmailConnectionPrompt({
			canConnectGmail: input.canConnectGmail,
			message: PERMISSION_LOST_MESSAGE,
			content: "grant-mark-permission",
			label: "Allow in Gmail",
			variant: "neutral",
			fields: [...gmailBodyFields(listState), { name: "intent", value: "mark" }, { name: "sender", value: input.sender.senderEmail }],
		})
		: { message: undefined, actions: [] };
	const key = checked ? "mark-read-stop" : "mark-read-start";
	const job = input.backfills.find((candidate) =>
		candidate.senderEmail === input.sender.senderEmail
		&& candidate.accountEmail === input.sender.accountEmail
		&& candidate.optionEnabledAt === optionEnabledAt);
	return {
		state,
		key,
		action: trackGmail(checked ? GMAIL_MARK_STOP_PATH : GMAIL_MARK_START_PATH, key),
		fields: senderFields,
		label: GMAIL_MARK_OPTION_LABEL,
		checked,
		disabled: !checked && (revoked || unavailable || !input.metadataScopeGranted),
		hint: consent.message,
		prompt: revoked ? [] : consent.actions,
		backfill: state === "on" ? markBackfill({ job, revoked, senderFields }) : undefined,
	};
}

function toRow(input: GmailMappingsInput & { sender: GmailMapping; job: GmailHistoryImportJob | undefined }): GmailMappingRow {
	const destination = gmailMappingDestination({ ...input, sender: input.sender });
	const currentJob = input.job !== undefined && importFollowsMapping({ job: input.job, mapping: input.sender, connection: input.connection }) ? input.job : undefined;
	const summary = currentJob === undefined ? undefined : summarizeGmailHistoryImport(currentJob);
	const importState: GmailImportState = summary?.status ?? "none";
	const forwarding = forwardingState({ connection: input.connection, destination, pending: forwardingPending(input.connection, input.sender) });
	const importable = destination.kind === "readlist" && input.connection.revokedAt === undefined;
	const deliveryMode = resolveGmailDeliveryMode(input.sender);
	return {
		sender: input.sender.senderEmail,
		newsletterName: input.candidates.get(input.sender.senderEmail)?.newsletterName,
		destinationKind: destination.kind,
		destinationLabel: destination.kind === "readlist" ? undefined : "Choose a readlist",
		destinationLinks: destination.kind === "readlist" ? destination.readlists.map((readlist) => ({ label: readlist.label, href: trackGmail(buildReadlistUrl({ readlist: readlist.slug }), "open-readlist") })) : [],
		destinationNote: destination.kind === "readlist" ? undefined : unresolvedNote({ reason: destination.reason, readlistChoiceShown: input.readlistChoiceShown }),
		deliveryMode,
		deliveryLabel: GMAIL_DELIVERY_COPY[deliveryMode].row,
		forwarding,
		forwardingLabel: FORWARDING_LABELS[forwarding],
		importState,
		importMessage: importMessage(summary),
		importCounts: importCounts(summary),
		consent: consentFor({
			sender: input.sender.senderEmail,
			canConnectGmail: input.canConnectGmail,
			importable,
			importState,
			readScopeGranted: input.readScopeGranted,
			markOn: input.sender.markImportedAt !== undefined,
			state: input.state,
		}),
		mark: markFor({
			sender: input.sender,
			destination,
			connection: input.connection,
			canConnectGmail: input.canConnectGmail,
			modifyScopeGranted: input.modifyScopeGranted,
			metadataScopeGranted: input.metadataScopeGranted,
			backfills: input.backfills,
			state: input.state,
		}),
		actions: rowActions({
			sender: input.sender,
			destination,
			importable,
			importState,
			job: currentJob,
			readScopeGranted: input.readScopeGranted,
			readlistChoiceShown: input.readlistChoiceShown,
			state: input.state,
		}),
	};
}

const RETRY_FILTER_ACTION: GmailFormAction = {
	key: "retry",
	method: "POST",
	action: trackGmail(GMAIL_FILTER_RETRY_PATH, "retry-filter"),
	label: "Try again",
	variant: "neutral",
	fields: [],
};

const FILTER_ACTIONS_BY_STATE: Record<GmailFilterState, GmailFormAction[]> = {
	reconnect: [],
	"waiting-confirmation": [],
	failed: [RETRY_FILTER_ACTION],
	updating: [RETRY_FILTER_ACTION],
	live: [],
	none: [],
};

const FILTER_MESSAGES: Record<Exclude<GmailFilterState, "failed" | "live">, string> = {
	reconnect: "Reconnect Gmail to update the forwarding rule.",
	"waiting-confirmation": "Forwarding starts once Gmail confirms the forwarding address.",
	updating: "Gmail hasn't accepted the latest change yet. Refresh in a moment, or try again.",
	none: "No forwarding rule in Gmail yet.",
};

function filterTargetLabel(input: {
	error: Extract<GmailFilterError, { code: "query-too-long" }>;
	connection: GmailConnection;
	destinations: ReadonlyMap<string, InboxAddressEntry>;
	readlists: readonly ReadlistRef[];
}): string {
	if (input.error.forwardTo === input.connection.gatewayAddress) return "senders without a readlist";
	const entry = input.destinations.get(input.error.forwardTo);
	assert(entry, "a readlist filter error must target a known address");
	return resolveEntry(entry, input.readlists).label;
}

function filterMessage(input: GmailMappingsInput, state: GmailFilterState): string {
	if (state === "failed") {
		const error = input.connection.lastFilterError;
		assert(error, "the failed filter state requires a stored filter error");
		if (error.code === "rejected") return `Gmail didn't accept the forwarding rule (${error.message}). Try again.`;
		const label = filterTargetLabel({ ...input, error });
		return `Gmail's forwarding rule for ${label} ran out of room at ${error.senderCapacity} of its ${error.senderCount} senders. Remove some newsletters, or move some to another readlist, then try again.`;
	}
	if (state === "live") {
		const senderCount = input.connection.filterSenderCount;
		assert(senderCount !== undefined && senderCount > 0, "the live filter state requires senders");
		return `Gmail is forwarding ${senderCount} ${senderCount === 1 ? "sender" : "senders"}.`;
	}
	return FILTER_MESSAGES[state];
}

function filterState(input: GmailMappingsInput, mapped: readonly GmailMapping[]): GmailFilterState {
	if (input.connection.revokedAt !== undefined) return "reconnect";
	if (input.connection.forwardingConfirmedAt === undefined) return "waiting-confirmation";
	if (input.connection.lastFilterError !== undefined) return "failed";
	if (mapped.some((sender) => forwardingPending(input.connection, sender))) return "updating";
	const senderCount = input.connection.filterSenderCount;
	return senderCount !== undefined && senderCount > 0 ? "live" : "none";
}

function rowOrder(left: GmailMappingRow, right: GmailMappingRow): number {
	const byName = (left.newsletterName ?? left.sender).localeCompare(right.newsletterName ?? right.sender);
	return byName === 0 ? left.sender.localeCompare(right.sender) : byName;
}

function addNewslettersActions(input: GmailMappingsInput): GmailAddNewslettersAction[] {
	if (!input.readlistChoiceShown) return [];
	return [{
		method: "GET",
		action: GMAIL_PATH,
		label: "Add newsletters",
		variant: input.addVariant,
		fields: gmailLinkFields({
			state: { search: input.state.search, discovery_after: input.state.discovery_after, add: "1" },
			discoveryStarted: input.discoveryStarted,
		}, "add-newsletters"),
	}];
}

export function toGmailMappingsViewModel(input: GmailMappingsInput): GmailMappingsViewModel {
	const mapped = input.senders.filter((sender) => sender.addedToFilterAt !== undefined);
	const latest = latestGmailImportsBySender(input.imports);
	const rows = mapped.map((sender) => toRow({ ...input, sender, job: latest.get(sender.senderEmail) })).sort(rowOrder);
	const importing = rows.some((row) => row.importState === "queued" || row.importState === "running" || row.mark?.backfill?.state === "running");
	const polling = importing && input.importsPollCount < GMAIL_HISTORY_IMPORT_MAX_POLLS;
	const state = filterState(input, mapped);
	const addActions = addNewslettersActions(input);
	return {
		rows,
		hasRows: rows.length > 0,
		headerActions: rows.length > 0 ? addActions : [],
		emptyActions: rows.length > 0 ? [] : addActions,
		polling,
		pollUrl: polling
			? `${buildGmailUrl({ ...closeGmailDialog(input.state), discovery: "started" })}&imports_poll=${input.importsPollCount + 1}`
			: undefined,
		exhausted: importing && !polling,
		filter: {
			state,
			message: filterMessage(input, state),
			presentation: state === "failed" ? "alert" : "copy",
			actions: FILTER_ACTIONS_BY_STATE[state],
		},
	};
}
