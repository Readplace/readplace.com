import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { sendComponent } from "@packages/web-shell";
import {
	type NewsletterCatalogDocument,
	type NewsletterCatalogRecord,
	type NewsletterCatalogSeed,
	type NewsletterFromRefusal,
	type NewsletterModerationResult,
	approveRecord,
	checkNewsletterFrom,
	correctRecordFrom,
	createRecord,
	editRecord,
	mergeSeed,
	reconsiderRecord,
	rejectRecord,
	withdrawRecord,
} from "@packages/domain/newsletter-catalog";
import type { FindUserByEmail } from "@packages/provider-contracts/auth";
import type { ReadNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";
import type { UpdateNewsletterCatalog, UpdateNewsletterCatalogResult } from "../../../domain/newsletter-catalog/update-newsletter-catalog";
import { flattenZodErrors } from "../../auth/flatten-zod-errors";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import type { ComponentError } from "../../shared/component-error.types";
import { AdminNewslettersPage } from "./admin-newsletters.component";
import {
	ADMIN_NEWSLETTER_FIELD_MESSAGES,
	AttemptedRecordSchema,
	CorrectNewsletterBodySchema,
	CorrectNewsletterValuesSchema,
	CreateNewsletterBodySchema,
	CreateNewsletterValuesSchema,
	EditNewsletterValuesSchema,
	FromCheckCandidateSchema,
	ReviewNewsletterBodySchema,
	UpdateNewsletterBodySchema,
} from "./admin-newsletters.schema";
import {
	type AdminNewslettersListState,
	type AdminNewslettersNotice,
	AdminNewslettersNoticeSchema,
	FROM_CHECKED_FIELDS,
	buildAdminNewslettersUrl,
	parseAdminNewslettersListState,
} from "./admin-newsletters.url";
import { type AdminNewsletterFormState, findCatalogRecord, toAdminNewslettersViewModel } from "./admin-newsletters.viewmodel";
import { initRefuseAdminAccess } from "./admin-forbidden.page";
import { initRequireAdmin } from "./require-admin.middleware";

export interface AdminNewslettersDependencies {
	findUserByEmail: FindUserByEmail;
	adminEmails: readonly string[];
	readNewsletterCatalog: ReadNewsletterCatalog;
	updateNewsletterCatalog: UpdateNewsletterCatalog;
	newsletterCatalogSeed: NewsletterCatalogSeed;
	now: () => Date;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
}

type CatalogFailure = Exclude<UpdateNewsletterCatalogResult, { ok: true }>["reason"];

type FailureResponse =
	| { kind: "duplicate"; statusCode: 422 }
	| { kind: "conflict"; statusCode: 409; message: string }
	| { kind: "storage"; statusCode: 503 };

const FAILURE_RESPONSES: Record<CatalogFailure, FailureResponse> = {
	duplicate: { kind: "duplicate", statusCode: 422 },
	stale: {
		kind: "conflict",
		statusCode: 409,
		message: "Someone else changed this newsletter after you opened it. Review the current record, then submit again.",
	},
	conflict: {
		kind: "conflict",
		statusCode: 409,
		message: "The catalog kept changing while this was saved. Nothing was changed. Submit again.",
	},
	missing: {
		kind: "conflict",
		statusCode: 409,
		message: "That newsletter is not in the catalog.",
	},
	"invalid-transition": {
		kind: "conflict",
		statusCode: 409,
		message: "That newsletter is no longer in a state that allows this action. Review the current record.",
	},
	unchanged: {
		kind: "conflict",
		statusCode: 409,
		message: "Nothing changed in the catalog.",
	},
	unavailable: { kind: "storage", statusCode: 503 },
};

const EMPTY_DOCUMENT: NewsletterCatalogDocument = { version: 1, records: [] };

const FROM_CHECK_LINES: Record<NewsletterFromRefusal, string> = {
	"unsupported-wildcard": ADMIN_NEWSLETTER_FIELD_MESSAGES.unsupportedWildcard,
	invalid: "",
};

function noStore(_req: Request, res: Response, next: NextFunction): void {
	res.setHeader("Cache-Control", "no-store");
	next();
}

function queryText(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

interface ResolvedForm {
	form: AdminNewsletterFormState | undefined;
	conflictRecord: NewsletterCatalogRecord | undefined;
}

type FormResolver = (document: NewsletterCatalogDocument, rebase: boolean) => ResolvedForm;

interface RespondInput {
	state: AdminNewslettersListState;
	notice: AdminNewslettersNotice | undefined;
	statusCode: number;
	storageFailed: boolean;
	conflict: string | undefined;
	errors: readonly ComponentError[];
	form: (document: NewsletterCatalogDocument) => ResolvedForm;
}

const NO_FORM: FormResolver = () => ({
	form: undefined,
	conflictRecord: undefined,
});

function reviewedForm(input: {
	from: string;
	attemptedUpdatedAt: string;
	build: (updatedAt: string) => AdminNewsletterFormState;
}): FormResolver {
	return (document, rebase) => {
		const current = rebase ? findCatalogRecord(document, input.from) : undefined;
		return {
			form: input.build(current === undefined ? input.attemptedUpdatedAt : current.updatedAt),
			conflictRecord: current,
		};
	};
}

export function initAdminNewslettersRoutes(deps: AdminNewslettersDependencies): Router {
	const router = express.Router();

	router.use(noStore);
	router.use(
		initRequireAdmin({
			findUserByEmail: deps.findUserByEmail,
			adminEmails: deps.adminEmails,
			serviceToken: "",
			refuse: initRefuseAdminAccess({ buildBannerState: deps.buildBannerState }),
		}),
	);

	async function respond(req: Request, res: Response, input: RespondInput): Promise<void> {
		const read = await deps.readNewsletterCatalog();
		if (!read.ok) deps.logError("[admin-newsletters] catalog unavailable");
		const document = read.ok ? read.document : EMPTY_DOCUMENT;
		const resolved = input.form(document);
		const viewModel = toAdminNewslettersViewModel({
			state: input.state,
			document,
			notice: input.notice,
			conflict: input.conflict,
			storageFailed: input.storageFailed,
			catalogLoaded: read.ok,
			form: resolved.form,
			errors: input.errors,
			conflictRecord: resolved.conflictRecord,
		});
		sendComponent(
			req,
			res,
			Base(
				AdminNewslettersPage(viewModel, {
					statusCode: read.ok ? input.statusCode : 503,
				}),
				await deps.buildBannerState(req),
			),
		);
	}

	async function respondToFailure(
		req: Request,
		res: Response,
		input: {
			state: AdminNewslettersListState;
			reason: CatalogFailure;
			duplicateField: string;
			form: FormResolver;
		},
	): Promise<void> {
		const failure = FAILURE_RESPONSES[input.reason];
		if (failure.kind === "storage") deps.logError(`[admin-newsletters] catalog write failed (${input.reason})`);
		await respond(req, res, {
			state: input.state,
			notice: undefined,
			statusCode: failure.statusCode,
			storageFailed: failure.kind === "storage",
			conflict: failure.kind === "conflict" ? failure.message : undefined,
			errors:
				failure.kind === "duplicate"
					? [
							{
								fieldName: input.duplicateField,
								message: ADMIN_NEWSLETTER_FIELD_MESSAGES.duplicateFrom,
							},
						]
					: [],
			form: (document) => input.form(document, failure.kind === "conflict"),
		});
	}

	async function commit(
		req: Request,
		res: Response,
		input: {
			state: AdminNewslettersListState;
			change: (document: NewsletterCatalogDocument) => NewsletterModerationResult;
			notice: AdminNewslettersNotice;
			duplicateField: string;
			form: FormResolver;
		},
	): Promise<void> {
		const result = await deps.updateNewsletterCatalog(input.change);
		if (result.ok) {
			res.redirect(303, buildAdminNewslettersUrl({ state: input.state, notice: input.notice }));
			return;
		}
		await respondToFailure(req, res, {
			state: input.state,
			reason: result.reason,
			duplicateField: input.duplicateField,
			form: input.form,
		});
	}

	router.get("/", async (req: Request, res: Response) => {
		const state = parseAdminNewslettersListState(req.query);
		const notice = AdminNewslettersNoticeSchema.safeParse(req.query.notice);
		const edit = queryText(req.query.edit);
		const correct = queryText(req.query.correct);
		await respond(req, res, {
			state,
			notice: notice.success ? notice.data : undefined,
			statusCode: 200,
			storageFailed: false,
			conflict: undefined,
			errors: [],
			form: (document) => {
				if (req.query.new === "1") {
					return {
						form: {
							kind: "create",
							values: CreateNewsletterValuesSchema.parse({}),
						},
						conflictRecord: undefined,
					};
				}
				const editing = edit === undefined ? undefined : findCatalogRecord(document, edit);
				if (editing !== undefined) {
					return {
						form: {
							kind: "edit",
							from: editing.from,
							updatedAt: editing.updatedAt,
							values: {
								name: editing.name ?? "",
								evidence_url: "",
								evidence_note: "",
							},
						},
						conflictRecord: undefined,
					};
				}
				const correcting = correct === undefined ? undefined : findCatalogRecord(document, correct);
				if (correcting !== undefined && correcting.status !== "rejected") {
					return {
						form: {
							kind: "correct",
							from: correcting.from,
							updatedAt: correcting.updatedAt,
							values: { new_from: "" },
						},
						conflictRecord: undefined,
					};
				}
				return { form: undefined, conflictRecord: undefined };
			},
		});
	});

	for (const field of FROM_CHECKED_FIELDS) {
		router.get(`/from-check/${field}`, (req: Request, res: Response) => {
			const check = checkNewsletterFrom(FromCheckCandidateSchema.parse(req.query[field]));
			res.type("text/plain").send(check.ok ? "" : FROM_CHECK_LINES[check.reason]);
		});
	}

	router.post("/records/create", async (req: Request, res: Response) => {
		const state = parseAdminNewslettersListState(req.body);
		const values = CreateNewsletterValuesSchema.parse(req.body);
		const form: FormResolver = () => ({
			form: { kind: "create", values },
			conflictRecord: undefined,
		});
		const parsed = CreateNewsletterBodySchema.safeParse(req.body);
		const evidenceMissing = parsed.success && parsed.data.evidence_url === undefined && parsed.data.evidence_note === undefined;
		if (!parsed.success || evidenceMissing) {
			await respond(req, res, {
				state,
				notice: undefined,
				statusCode: 422,
				storageFailed: false,
				conflict: undefined,
				errors: parsed.success
					? [
							{
								fieldName: "evidence_note",
								message: ADMIN_NEWSLETTER_FIELD_MESSAGES.evidenceRequired,
							},
						]
					: flattenZodErrors(parsed.error.issues),
				form: (document) => form(document, false),
			});
			return;
		}
		const body = parsed.data;
		await commit(req, res, {
			state,
			notice: "created",
			duplicateField: "from",
			change: (document) =>
				createRecord(document, {
					from: body.from,
					name: body.name,
					evidence: { url: body.evidence_url, note: body.evidence_note },
					now: deps.now(),
				}),
			form,
		});
	});

	router.post("/records/update", async (req: Request, res: Response) => {
		const state = parseAdminNewslettersListState(req.body);
		const attempted = AttemptedRecordSchema.parse(req.body);
		const values = EditNewsletterValuesSchema.parse(req.body);
		const form = reviewedForm({
			from: attempted.from,
			attemptedUpdatedAt: attempted.updated_at,
			build: (updatedAt) => ({
				kind: "edit",
				from: attempted.from,
				updatedAt,
				values,
			}),
		});
		const parsed = UpdateNewsletterBodySchema.safeParse(req.body);
		if (!parsed.success) {
			await respond(req, res, {
				state,
				notice: undefined,
				statusCode: 422,
				storageFailed: false,
				conflict: undefined,
				errors: flattenZodErrors(parsed.error.issues),
				form: (document) => form(document, false),
			});
			return;
		}
		const body = parsed.data;
		await commit(req, res, {
			state,
			notice: "updated",
			duplicateField: "from",
			change: (document) =>
				editRecord(document, {
					from: body.from,
					expectedUpdatedAt: body.updated_at,
					name: body.name,
					evidenceUrl: body.evidence_url,
					evidenceNote: body.evidence_note,
					now: deps.now(),
				}),
			form,
		});
	});

	router.post("/records/correct", async (req: Request, res: Response) => {
		const state = parseAdminNewslettersListState(req.body);
		const attempted = AttemptedRecordSchema.parse(req.body);
		const values = CorrectNewsletterValuesSchema.parse(req.body);
		const form = reviewedForm({
			from: attempted.from,
			attemptedUpdatedAt: attempted.updated_at,
			build: (updatedAt) => ({
				kind: "correct",
				from: attempted.from,
				updatedAt,
				values,
			}),
		});
		const parsed = CorrectNewsletterBodySchema.safeParse(req.body);
		if (!parsed.success) {
			await respond(req, res, {
				state,
				notice: undefined,
				statusCode: 422,
				storageFailed: false,
				conflict: undefined,
				errors: flattenZodErrors(parsed.error.issues),
				form: (document) => form(document, false),
			});
			return;
		}
		const body = parsed.data;
		await commit(req, res, {
			state,
			notice: "corrected",
			duplicateField: "new_from",
			change: (document) =>
				findCatalogRecord(document, body.from)?.status === "rejected"
					? { ok: false, reason: "invalid-transition" }
					: correctRecordFrom(document, {
							from: body.from,
							newFrom: body.new_from,
							expectedUpdatedAt: body.updated_at,
							now: deps.now(),
						}),
			form,
		});
	});

	const REVIEW_ACTIONS = [
		{ path: "approve", notice: "approved", apply: approveRecord },
		{ path: "reject", notice: "rejected", apply: rejectRecord },
		{ path: "withdraw", notice: "withdrawn", apply: withdrawRecord },
		{ path: "reconsider", notice: "reconsidered", apply: reconsiderRecord },
	] as const;

	for (const action of REVIEW_ACTIONS) {
		router.post(`/records/${action.path}`, async (req: Request, res: Response) => {
			const state = parseAdminNewslettersListState(req.body);
			const parsed = ReviewNewsletterBodySchema.safeParse(req.body);
			if (!parsed.success) {
				res.status(400).type("text").send("Malformed newsletter review request.");
				return;
			}
			const body = parsed.data;
			await commit(req, res, {
				state,
				notice: action.notice,
				duplicateField: "from",
				change: (document) =>
					action.apply(document, {
						from: body.from,
						expectedUpdatedAt: body.updated_at,
						now: deps.now(),
					}),
				form: NO_FORM,
			});
		});
	}

	router.post("/seed/import", async (req: Request, res: Response) => {
		const state = parseAdminNewslettersListState(req.body);
		const result = await deps.updateNewsletterCatalog((document) => mergeSeed(document, deps.newsletterCatalogSeed, deps.now()));
		if (result.ok || result.reason === "unchanged") {
			res.redirect(303, buildAdminNewslettersUrl({ state, notice: "seeded" }));
			return;
		}
		await respondToFailure(req, res, {
			state,
			reason: result.reason,
			duplicateField: "from",
			form: NO_FORM,
		});
	});

	return router;
}
