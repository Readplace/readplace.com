import assert from "node:assert";
import { z } from "zod";
import { ForwardableSenderSchema, pickerDeliveryMode } from "@packages/domain/gmail";
import type { DiscoveredGmailSender, ForwardableSender, GmailConnection, GmailDiscovery, GmailMapping } from "@packages/domain/gmail";
import type { InboxAddress } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, readerReadlists } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { MapSenderToReadlist } from "../../../domain/gmail/resolve-readlist-mapping";
import type { GmailImportActions } from "./gmail-import-actions";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";
import { buildGmailUrl, type GmailPageError, type GmailUrlParams, gmailSelectedReadlists, parseGmailPickerState } from "./gmail.url";

const SendersBodySchema = z.object({
	sender: z.union([ForwardableSenderSchema, z.array(ForwardableSenderSchema).min(1)])
		.transform((value) => [...new Set(typeof value === "string" ? [value] : value)]),
});

const SaveBodySchema = z.object({
	readlist: z.union([z.string(), z.array(z.string())]).optional(),
	import: z.literal("1").optional().catch(undefined),
});

export function discoveryMatchesConnection(discovery: GmailDiscovery | undefined, connection: GmailConnection): boolean {
	return discovery?.accountEmail.trim().toLowerCase() === connection.accountEmail?.trim().toLowerCase() && discovery?.gatewayAddress === connection.gatewayAddress;
}

export type SaveGmailSenders = (input: { userId: UserId; body: unknown }) => Promise<string>;

export function initSaveGmailSenders(deps: {
	gmail: GmailIntegrationDependencies;
	imports: GmailImportActions;
	mapSenderToReadlist: MapSenderToReadlist;
}): SaveGmailSenders {
	const { gmail } = deps;
	return async ({ userId, body }) => {
		const state = parseGmailPickerState(body);
		const parsedSave = SaveBodySchema.safeParse(body);
		const importChoice = parsedSave.success ? parsedSave.data.import : undefined;
		const invalid = (error: GmailPageError): string => buildGmailUrl({ ...state, import: importChoice, error, discovery: "started" });
		if (!parsedSave.success) return invalid("readlist_invalid");
		const parsedSenders = SendersBodySchema.safeParse(body);
		if (!parsedSenders.success) return invalid("sender_invalid");
		const senders = parsedSenders.data.sender;
		const [discovered, discovery, connection, definitions] = await Promise.all([
			gmail.gmailDiscoveryStore.listSendersByUserId(userId),
			gmail.gmailDiscoveryStore.findDiscoveryByUserId(userId),
			gmail.gmailConnectionStore.findConnectionByUserId(userId),
			gmail.listReadlistDefinitions(userId),
		]);
		assert(connection, "the connected middleware requires a Gmail connection");
		const accountEmail = connection.accountEmail;
		const [mappings, observed]: [GmailMapping[], DiscoveredGmailSender[]] = accountEmail === undefined ? [[], []] : await Promise.all([
			gmail.gmailMappingStore.listMappings({ userId, accountEmail }),
			gmail.gmailMonitoringStore.listObservedSenders({ userId, accountEmail }),
		]);
		const existingFor = (sender: ForwardableSender) => mappings.find((mapping) => mapping.senderEmail === sender);
		const sameMailbox = discoveryMatchesConnection(discovery, connection);
		const known = (sender: ForwardableSender) =>
			existingFor(sender)?.addedToFilterAt !== undefined
			|| (sameMailbox && discovered.some((entry) => entry.email === sender))
			|| observed.some((entry) => entry.email === sender);
		if (!senders.every(known)) return invalid("sender_unknown");
		assert(accountEmail, "a sender this connection knows implies its Gmail account is recorded");
		const choices = [...new Set(gmailSelectedReadlists(state))];
		const readlists = readerReadlists(definitions);
		if (choices.some((slug) => !readlists.some((entry) => entry.slug === slug))) return invalid("readlist_invalid");
		const choiceFor = senders.find((sender) => sender === state.readlist_choice_for);
		if (choiceFor !== undefined && existingFor(choiceFor)?.mappedAddresses === undefined && definitions.length > 0) {
			return invalid("readlist_choice_required");
		}
		const selected = readlists.filter((entry) => entry.slug !== DEFAULT_READLIST_SLUG && choices.includes(entry.slug)).map((entry) => entry.slug);
		const saved: { sender: ForwardableSender; destinations: [InboxAddress, ...InboxAddress[]]; newMapping: boolean }[] = [];
		for (const sender of senders) {
			const existing = existingFor(sender);
			const { destinations } = await deps.mapSenderToReadlist({
				userId,
				accountEmail,
				sender,
				readlists: selected,
				deliveryMode: state.delivery ?? pickerDeliveryMode(existing),
			});
			saved.push({ sender, destinations, newMapping: existing?.addedToFilterAt === undefined });
		}
		await gmail.publishRewriteGmailFilter({ userId, reason: "sender-added" });
		const detection = await gmail.detectNewsletters(senders);
		for (const sender of senders) {
			if (detection.status === "unavailable" || detection.recognized.get(sender)?.match !== "exact") {
				await gmail.publishSubmitNewsletterSender({ senderEmail: sender });
			}
		}
		const savedNotice: GmailUrlParams = saved.length === 1
			? { notice: saved.every((entry) => entry.newMapping) ? "sender_mapped" : "sender_remapped" }
			: { notice: "senders_saved", saved: saved.length };
		const kept: GmailUrlParams = { search: state.search, discovery: "started" };
		const newMappings = saved.filter((entry) => entry.newMapping);
		if (importChoice !== "1" || newMappings.length === 0) return buildGmailUrl({ ...kept, ...savedNotice });
		let importNotice: GmailUrlParams["notice"];
		let inProgress = false;
		for (const entry of newMappings) {
			const outcome = await deps.imports.start({ userId, sender: entry.sender, destinations: entry.destinations, connection: { ...connection, accountEmail } });
			if (outcome.ok) {
				importNotice = outcome.notice;
				continue;
			}
			if (outcome.error === "import_revoked") return buildGmailUrl({ ...kept, ...savedNotice, error: "import_revoked" });
			inProgress = true;
		}
		if (inProgress) return buildGmailUrl({ ...kept, ...savedNotice, error: "import_in_progress" });
		return buildGmailUrl({ ...kept, notice: importNotice });
	};
}
