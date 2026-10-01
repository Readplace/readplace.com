import {
	type NewsletterCatalogDocument,
	type NewsletterCatalogRecord,
	type NewsletterEvidence,
	type NewsletterListStatus,
	type NewsletterStatus,
	listRecords,
} from "@packages/domain/newsletter-catalog";
import { withInternalTracking } from "@packages/web-shell";
import type { ComponentError } from "../../shared/component-error.types";
import type { CorrectNewsletterValues, CreateNewsletterValues, EditNewsletterValues } from "./admin-newsletters.schema";
import {
	ADMIN_NEWSLETTERS_PATH,
	type AdminNewslettersListState,
	type AdminNewslettersNotice,
	type FromCheckedField,
	adminNewslettersListFields,
} from "./admin-newsletters.url";

const ADMIN_NEWSLETTERS_SOURCE = "admin-newsletters";

export interface AdminHiddenField {
	name: string;
	value: string;
}

export interface AdminFormControl {
	method: "GET" | "POST";
	action: string;
	boost: "true" | "false";
	fields: AdminHiddenField[];
}

export type AdminNewsletterFormState =
	| { kind: "create"; values: CreateNewsletterValues }
	| {
			kind: "edit";
			from: string;
			updatedAt: string;
			values: EditNewsletterValues;
		}
	| {
			kind: "correct";
			from: string;
			updatedAt: string;
			values: CorrectNewsletterValues;
		};

export type AdminNewsletterRowActionKey = "approve" | "reject" | "withdraw" | "reconsider" | "edit" | "correct";

type ButtonVariant = "primary" | "secondary" | "destructive";

export interface AdminNewsletterRowAction {
	key: AdminNewsletterRowActionKey;
	label: string;
	variant: ButtonVariant;
	form: AdminFormControl;
}

export interface AdminNewsletterRecordView {
	from: string;
	nameLabel: string;
	named: boolean;
	status: NewsletterStatus;
	statusLabel: string;
	replacedBy: string | undefined;
	updatedAt: string;
	updatedLabel: string;
	evidence: {
		kindLabel: string;
		url: string | undefined;
		note: string | undefined;
	}[];
}

export interface AdminNewsletterRowView extends AdminNewsletterRecordView {
	actions: AdminNewsletterRowAction[];
}

export interface AdminNewsletterFormatView {
	example: string;
	meaning: string;
}

export interface AdminNewsletterFieldView {
	name: string;
	id: string;
	label: string;
	type: "text" | "url";
	value: string;
	required: boolean;
	multiline: boolean;
	maxLength: number;
	hint: string;
	formats: readonly AdminNewsletterFormatView[];
	liveCheckPath: string | undefined;
	error: string | undefined;
}

export interface AdminNewsletterFormView {
	kind: AdminNewsletterFormState["kind"];
	title: string;
	intro: string;
	subject: string | undefined;
	submitLabel: string;
	submit: AdminFormControl;
	fields: AdminNewsletterFieldView[];
	cancel: AdminFormControl;
	conflict: AdminNewsletterRecordView | undefined;
}

export interface AdminNewslettersViewModel {
	listStatus: NewsletterListStatus;
	q: string;
	notice: string | undefined;
	conflict: string | undefined;
	storageAlert: string | undefined;
	tabs: {
		status: NewsletterListStatus;
		label: string;
		ariaCurrent: "page" | "false";
		form: AdminFormControl;
	}[];
	search: AdminFormControl;
	add: AdminFormControl;
	seed: AdminFormControl | undefined;
	empty: { isEmpty: boolean; text: string };
	summary: string;
	rows: AdminNewsletterRowView[];
	pagination:
		| {
				page: number;
				totalPages: number;
				controls: {
					key: "prev" | "next";
					label: string;
					disabled: boolean;
					form: AdminFormControl;
				}[];
			}
		| undefined;
	form: AdminNewsletterFormView | undefined;
}

const TABS: { status: NewsletterListStatus; label: string }[] = [
	{ status: "pending", label: "Pending" },
	{ status: "approved", label: "Approved" },
	{ status: "rejected", label: "Rejected" },
	{ status: "all", label: "All" },
];

const STATUS_LABELS: Record<NewsletterStatus, string> = {
	pending: "Pending",
	approved: "Approved",
	rejected: "Rejected",
};

const EVIDENCE_LABELS: Record<NewsletterEvidence["kind"], string> = {
	seed: "Seed",
	"user-submission": "Reader submission",
	admin: "Admin",
};

const EMPTY_TEXT: Record<NewsletterListStatus, string> = {
	pending: "No newsletters are waiting for review.",
	approved: "No newsletters are approved yet.",
	rejected: "No newsletters are rejected.",
	all: "The catalog has no newsletters yet.",
};

const NOTICE_TEXT: Record<AdminNewslettersNotice, string> = {
	created: "Newsletter added as pending. Approve it once the FROM address is verified.",
	updated: "Newsletter updated.",
	approved: "Newsletter approved. Readers now see it as a known newsletter.",
	rejected: "Newsletter rejected.",
	withdrawn: "Approval withdrawn. Readers keep their own mappings for this sender.",
	reconsidered: "Newsletter moved back to pending.",
	corrected: "FROM address corrected. The new address is pending and the old one is rejected.",
	seeded: "Seed imported. New entries are pending; entries already in the catalog were left as they were.",
};

const ROW_ACTIONS: Record<NewsletterStatus, AdminNewsletterRowActionKey[]> = {
	pending: ["approve", "reject", "edit", "correct"],
	approved: ["withdraw", "edit", "correct"],
	rejected: ["reconsider", "edit"],
};

const REPLACED_ROW_ACTIONS: AdminNewsletterRowActionKey[] = ["edit"];

const STORAGE_ALERTS = {
	write: "The newsletter catalog is unavailable. Nothing was changed. Try again shortly.",
	read: "The newsletter catalog could not be loaded. Try again shortly.",
} as const;

const UNLOADED_TEXT = "The catalog could not be loaded, so its newsletters are not shown.";

function trackedForm(input: { method: "GET" | "POST"; path: string; content: string; fields: AdminHiddenField[] }): AdminFormControl {
	const tracking = { source: ADMIN_NEWSLETTERS_SOURCE, content: input.content };
	if (input.method === "POST") {
		return {
			method: "POST",
			action: withInternalTracking(input.path, tracking),
			boost: "false",
			fields: input.fields,
		};
	}
	return {
		method: "GET",
		action: input.path,
		boost: "true",
		fields: [
			...input.fields,
			{ name: "utm_source", value: tracking.source },
			{ name: "utm_medium", value: "internal" },
			{ name: "utm_content", value: tracking.content },
		],
	};
}

function reviewForm(input: { key: AdminNewsletterRowActionKey; from: string; updatedAt: string; state: AdminNewslettersListState }) {
	return trackedForm({
		method: "POST",
		path: `${ADMIN_NEWSLETTERS_PATH}/records/${input.key}`,
		content: input.key,
		fields: [
			{ name: "from", value: input.from },
			{ name: "updated_at", value: input.updatedAt },
			...adminNewslettersListFields(input.state),
		],
	});
}

function openFormControl(input: { key: "edit" | "correct"; from: string; state: AdminNewslettersListState }) {
	return trackedForm({
		method: "GET",
		path: ADMIN_NEWSLETTERS_PATH,
		content: input.key,
		fields: [...adminNewslettersListFields(input.state), { name: input.key, value: input.from }],
	});
}

const ROW_ACTION_SPECS: Record<
	AdminNewsletterRowActionKey,
	{
		label: string;
		variant: ButtonVariant;
		form: (record: NewsletterCatalogRecord, state: AdminNewslettersListState) => AdminFormControl;
	}
> = {
	approve: {
		label: "Approve",
		variant: "primary",
		form: (record, state) =>
			reviewForm({
				key: "approve",
				from: record.from,
				updatedAt: record.updatedAt,
				state,
			}),
	},
	reject: {
		label: "Reject",
		variant: "destructive",
		form: (record, state) =>
			reviewForm({
				key: "reject",
				from: record.from,
				updatedAt: record.updatedAt,
				state,
			}),
	},
	withdraw: {
		label: "Withdraw",
		variant: "destructive",
		form: (record, state) =>
			reviewForm({
				key: "withdraw",
				from: record.from,
				updatedAt: record.updatedAt,
				state,
			}),
	},
	reconsider: {
		label: "Reconsider",
		variant: "secondary",
		form: (record, state) =>
			reviewForm({
				key: "reconsider",
				from: record.from,
				updatedAt: record.updatedAt,
				state,
			}),
	},
	edit: {
		label: "Edit",
		variant: "secondary",
		form: (record, state) => openFormControl({ key: "edit", from: record.from, state }),
	},
	correct: {
		label: "Correct FROM",
		variant: "secondary",
		form: (record, state) => openFormControl({ key: "correct", from: record.from, state }),
	},
};

function formatInstant(iso: string): string {
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function recordView(record: NewsletterCatalogRecord): AdminNewsletterRecordView {
	return {
		from: record.from,
		nameLabel: record.name ?? "No name yet",
		named: record.name !== undefined,
		status: record.status,
		statusLabel: STATUS_LABELS[record.status],
		replacedBy: record.replacedBy,
		updatedAt: record.updatedAt,
		updatedLabel: formatInstant(record.updatedAt),
		evidence: record.evidence.map((item) => ({
			kindLabel: EVIDENCE_LABELS[item.kind],
			url: item.url,
			note: item.note,
		})),
	};
}

function rowView(record: NewsletterCatalogRecord, state: AdminNewslettersListState): AdminNewsletterRowView {
	return {
		...recordView(record),
		actions: (record.replacedBy === undefined ? ROW_ACTIONS[record.status] : REPLACED_ROW_ACTIONS).map((key) => ({
			key,
			label: ROW_ACTION_SPECS[key].label,
			variant: ROW_ACTION_SPECS[key].variant,
			form: ROW_ACTION_SPECS[key].form(record, state),
		})),
	};
}

export function findCatalogRecord(document: NewsletterCatalogDocument, from: string): NewsletterCatalogRecord | undefined {
	return document.records.find((record) => record.from === from);
}

function field(input: {
	name: string;
	label: string;
	type: AdminNewsletterFieldView["type"];
	value: string;
	required: boolean;
	multiline: boolean;
	maxLength: number;
	hint: string;
	errors: readonly ComponentError[];
}): AdminNewsletterFieldView {
	return {
		name: input.name,
		id: `admin-newsletter-${input.name}`,
		label: input.label,
		type: input.type,
		value: input.value,
		required: input.required,
		multiline: input.multiline,
		maxLength: input.maxLength,
		hint: input.hint,
		formats: [],
		liveCheckPath: undefined,
		error: input.errors.find((error) => error.fieldName === input.name)?.message,
	};
}

const FROM_FORMATS: readonly AdminNewsletterFormatView[] = [
	{ example: "newsletter@example.com", meaning: "one sender. Keep dots and plus tags." },
	{ example: "*@example.com", meaning: "every sender at example.com, but not mail.example.com. An approved exact address still wins." },
];

const FROM_HINT = "A * anywhere else, like news*@example.com or *@*.example.com, isn't supported.";

function fromField(input: {
	name: FromCheckedField;
	label: string;
	value: string;
	errors: readonly ComponentError[];
}): AdminNewsletterFieldView {
	return {
		...field({
			name: input.name,
			label: input.label,
			type: "text",
			value: input.value,
			required: true,
			multiline: false,
			maxLength: 254,
			hint: FROM_HINT,
			errors: input.errors,
		}),
		formats: FROM_FORMATS,
		liveCheckPath: `${ADMIN_NEWSLETTERS_PATH}/from-check/${input.name}`,
	};
}

function nameAndEvidenceFields(values: EditNewsletterValues, errors: readonly ComponentError[]): AdminNewsletterFieldView[] {
	return [
		field({
			name: "name",
			label: "Newsletter name",
			type: "text",
			value: values.name,
			required: false,
			multiline: false,
			maxLength: 80,
			hint: "Shown to readers once approved. Leave empty when unknown.",
			errors,
		}),
		field({
			name: "evidence_url",
			label: "Evidence link",
			type: "url",
			value: values.evidence_url,
			required: false,
			multiline: false,
			maxLength: 2048,
			hint: "A publisher page that names this exact FROM address.",
			errors,
		}),
		field({
			name: "evidence_note",
			label: "Evidence note",
			type: "text",
			value: values.evidence_note,
			required: false,
			multiline: true,
			maxLength: 500,
			hint: "Where the address was verified, for example a real FROM header.",
			errors,
		}),
	];
}

function formView(input: {
	form: AdminNewsletterFormState;
	state: AdminNewslettersListState;
	errors: readonly ComponentError[];
	conflict: NewsletterCatalogRecord | undefined;
}): AdminNewsletterFormView {
	const listFields = adminNewslettersListFields(input.state);
	const cancel = trackedForm({
		method: "GET",
		path: ADMIN_NEWSLETTERS_PATH,
		content: `cancel-${input.form.kind}`,
		fields: listFields,
	});
	const conflict = input.conflict === undefined ? undefined : recordView(input.conflict);
	switch (input.form.kind) {
		case "create":
			return {
				kind: "create",
				title: "Add a newsletter",
				intro: "New records start as pending. Approve them once the FROM address is verified.",
				subject: undefined,
				submitLabel: "Add as pending",
				submit: trackedForm({
					method: "POST",
					path: `${ADMIN_NEWSLETTERS_PATH}/records/create`,
					content: "create",
					fields: listFields,
				}),
				fields: [
					fromField({
						name: "from",
						label: "FROM address",
						value: input.form.values.from,
						errors: input.errors,
					}),
					...nameAndEvidenceFields(input.form.values, input.errors),
				],
				cancel,
				conflict,
			};
		case "edit":
			return {
				kind: "edit",
				title: "Edit newsletter",
				intro: "Evidence you add is kept beside the existing evidence.",
				subject: input.form.from,
				submitLabel: "Save changes",
				submit: trackedForm({
					method: "POST",
					path: `${ADMIN_NEWSLETTERS_PATH}/records/update`,
					content: "update",
					fields: [{ name: "from", value: input.form.from }, { name: "updated_at", value: input.form.updatedAt }, ...listFields],
				}),
				fields: nameAndEvidenceFields(input.form.values, input.errors),
				cancel,
				conflict,
			};
		case "correct":
			return {
				kind: "correct",
				title: "Correct the FROM address",
				intro: "The corrected address becomes a new pending record. The old address is rejected so it is never submitted again.",
				subject: input.form.from,
				submitLabel: "Replace FROM address",
				submit: trackedForm({
					method: "POST",
					path: `${ADMIN_NEWSLETTERS_PATH}/records/correct`,
					content: "correct",
					fields: [{ name: "from", value: input.form.from }, { name: "updated_at", value: input.form.updatedAt }, ...listFields],
				}),
				fields: [
					fromField({
						name: "new_from",
						label: "Corrected FROM address",
						value: input.form.values.new_from,
						errors: input.errors,
					}),
				],
				cancel,
				conflict,
			};
	}
}

function paginationView(input: {
	page: number;
	totalPages: number;
	state: AdminNewslettersListState;
}): AdminNewslettersViewModel["pagination"] {
	if (input.totalPages <= 1) return undefined;
	const pageControl = (key: "prev" | "next", label: string, page: number) => ({
		key,
		label,
		disabled: page < 1 || page > input.totalPages,
		form: trackedForm({
			method: "GET",
			path: ADMIN_NEWSLETTERS_PATH,
			content: `page-${key}`,
			fields: adminNewslettersListFields({ ...input.state, page }),
		}),
	});
	return {
		page: input.page,
		totalPages: input.totalPages,
		controls: [pageControl("prev", "Previous", input.page - 1), pageControl("next", "Next", input.page + 1)],
	};
}

export function toAdminNewslettersViewModel(input: {
	state: AdminNewslettersListState;
	document: NewsletterCatalogDocument;
	notice: AdminNewslettersNotice | undefined;
	conflict: string | undefined;
	storageFailed: boolean;
	catalogLoaded: boolean;
	form: AdminNewsletterFormState | undefined;
	errors: readonly ComponentError[];
	conflictRecord: NewsletterCatalogRecord | undefined;
}): AdminNewslettersViewModel {
	const listed = listRecords(input.document, {
		listStatus: input.state.listStatus,
		q: input.state.q,
		page: input.state.page,
	});
	const state = { ...input.state, page: listed.page };
	const listFields = adminNewslettersListFields(state);
	return {
		listStatus: state.listStatus,
		q: state.q,
		notice: input.notice === undefined ? undefined : NOTICE_TEXT[input.notice],
		conflict: input.conflict,
		storageAlert: input.storageFailed ? STORAGE_ALERTS.write : input.catalogLoaded ? undefined : STORAGE_ALERTS.read,
		tabs: TABS.map((tab) => ({
			status: tab.status,
			label: tab.label,
			ariaCurrent: tab.status === state.listStatus ? "page" : "false",
			form: trackedForm({
				method: "GET",
				path: ADMIN_NEWSLETTERS_PATH,
				content: `tab-${tab.status}`,
				fields: [
					{ name: "list_status", value: tab.status },
					{ name: "q", value: state.q },
				],
			}),
		})),
		search: trackedForm({
			method: "GET",
			path: ADMIN_NEWSLETTERS_PATH,
			content: "search",
			fields: [{ name: "list_status", value: state.listStatus }],
		}),
		add: trackedForm({
			method: "GET",
			path: ADMIN_NEWSLETTERS_PATH,
			content: "add",
			fields: [...listFields, { name: "new", value: "1" }],
		}),
		seed:
			state.listStatus === "pending" && input.catalogLoaded
				? trackedForm({
						method: "POST",
						path: `${ADMIN_NEWSLETTERS_PATH}/seed/import`,
						content: "import-seed",
						fields: listFields,
					})
				: undefined,
		empty: {
			isEmpty: listed.total === 0,
			text: !input.catalogLoaded ? UNLOADED_TEXT : state.q === "" ? EMPTY_TEXT[state.listStatus] : `No newsletters match “${state.q}”.`,
		},
		summary: input.catalogLoaded ? `${listed.total} ${listed.total === 1 ? "newsletter" : "newsletters"}` : "Newsletter count unavailable",
		rows: listed.records.map((record) => rowView(record, state)),
		pagination: paginationView({
			page: listed.page,
			totalPages: listed.totalPages,
			state,
		}),
		form:
			input.form === undefined
				? undefined
				: formView({
						form: input.form,
						state,
						errors: input.errors,
						conflict: input.conflictRecord,
					}),
	};
}
