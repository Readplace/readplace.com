import type { InboxAddress } from "../inbox/inbox-address.schema";
import type { UserId } from "../user";
import type { ForwardableSender } from "./build-forwarding-filter-query";
import type { GmailAccountEmail } from "./gmail-account-email.schema";
import type { GmailDeliveryMode } from "./gmail-delivery-mode";

export interface GmailMapping {
	accountEmail: GmailAccountEmail;
	senderEmail: ForwardableSender;
	addedToFilterAt: string | undefined;
	mappedAddresses: [InboxAddress, ...InboxAddress[]] | undefined;
	mappedAt: string | undefined;
	deliveryMode: GmailDeliveryMode | undefined;
}

export interface GmailMappingStore {
	addSenderToFilter: (input: {
		userId: UserId;
		accountEmail: GmailAccountEmail;
		senderEmail: ForwardableSender;
	}) => Promise<void>;
	mapSenderToAddress: (input: {
		userId: UserId;
		accountEmail: GmailAccountEmail;
		senderEmail: ForwardableSender;
		mappedAddresses: [InboxAddress, ...InboxAddress[]];
		deliveryMode: GmailDeliveryMode;
	}) => Promise<void>;
	findMapping: (input: {
		userId: UserId;
		accountEmail: GmailAccountEmail;
		senderEmail: ForwardableSender;
	}) => Promise<GmailMapping | undefined>;
	listMappings: (input: {
		userId: UserId;
		accountEmail: GmailAccountEmail;
	}) => Promise<GmailMapping[]>;
	listMappingsByUserId: (userId: UserId) => Promise<GmailMapping[]>;
	removeMapping: (input: {
		userId: UserId;
		accountEmail: GmailAccountEmail;
		senderEmail: ForwardableSender;
	}) => Promise<void>;
	deleteAllByUserId: (userId: UserId) => Promise<void>;
}
