import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { ReaderArticleHashId } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindReadlistArticleById,
	ListReadlistDefinitions,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";
import { sendComponent } from "@packages/web-shell";
import type { QueueDigestMarkRead } from "../../../domain/email/queue-digest-mark-read-token";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import { QUEUE_DIGEST_MARK_READ_PATH } from "../../queue-digest-email";
import { QueueDigestMarkReadPage } from "./queue-digest-mark-read.component";

interface QueueDigestMarkReadDependencies {
	verifyMarkReadToken: (token: string) => QueueDigestMarkRead | undefined;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	findArticleById: FindArticleById;
	findReadlistArticleById: FindReadlistArticleById;
	listReadlistDefinitions: ListReadlistDefinitions;
	buildBannerState: BuildBannerState;
}

const MarkReadQuerySchema = z.object({ t: z.string() });

export function initQueueDigestMarkReadRoutes(deps: QueueDigestMarkReadDependencies): Router {
	const router = express.Router();

	function digestOf(req: Request): { token: string; markRead: QueueDigestMarkRead } | undefined {
		const query = MarkReadQuerySchema.safeParse(req.query);
		if (!query.success) return undefined;
		const markRead = deps.verifyMarkReadToken(query.data.t);
		if (markRead === undefined) return undefined;
		return { token: query.data.t, markRead };
	}

	async function readlistHolding(input: { id: ReaderArticleHashId; userId: UserId }): Promise<ReadlistSlug | undefined> {
		if (await deps.findArticleById(input.id, input.userId)) return DEFAULT_READLIST_SLUG;
		for (const definition of await deps.listReadlistDefinitions(input.userId)) {
			if (await deps.findReadlistArticleById({ ...input, readlist: definition.slug })) return definition.slug;
		}
		return undefined;
	}

	router.get(QUEUE_DIGEST_MARK_READ_PATH, noindexMiddleware, async (req: Request, res: Response) => {
		const digest = digestOf(req);
		if (!digest) {
			sendComponent(req, res, Base(QueueDigestMarkReadPage({ kind: "invalid" }), await deps.buildBannerState(req)));
			return;
		}
		const count = digest.markRead.articleIds.length;
		sendComponent(
			req,
			res,
			Base(
				QueueDigestMarkReadPage(
					req.query.done === "1" ? { kind: "done", count } : { kind: "confirm", token: digest.token, count },
				),
				await deps.buildBannerState(req),
			),
		);
	});

	router.post(QUEUE_DIGEST_MARK_READ_PATH, noindexMiddleware, async (req: Request, res: Response) => {
		const digest = digestOf(req);
		if (!digest) {
			sendComponent(req, res, Base(QueueDigestMarkReadPage({ kind: "invalid" }), await deps.buildBannerState(req)));
			return;
		}
		const { userId, articleIds } = digest.markRead;
		await Promise.all(
			articleIds.map(async (id) => {
				const addressed = await readlistHolding({ id, userId });
				if (addressed !== undefined) await deps.updateArticleStatusAcrossReadlists({ id, userId, addressed, status: "read" });
			}),
		);
		const done = new URLSearchParams({ t: digest.token, done: "1" });
		res.redirect(303, `${QUEUE_DIGEST_MARK_READ_PATH}?${done.toString()}`);
	});

	return router;
}
