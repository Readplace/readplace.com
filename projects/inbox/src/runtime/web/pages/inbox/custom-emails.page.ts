import assert from "node:assert";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import { sendComponent } from "@packages/web-shell";
import {
	AliasNameSchema,
	countLiveCappedAddresses,
	CUSTOM_EMAILS_PATH,
	DEFAULT_INBOX_ADDRESS_PURPOSE,
	INBOX_ADDRESS_MAX_PER_USER,
	InboxAddressLimitReachedError,
	InboxAddressSchema,
	isLiveAddress,
	isCappedAddress,
	normalizeAliasName,
	addressCapReached,
} from "@packages/domain/inbox";
import type { InboxAddressStore } from "@packages/domain/inbox";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { InboxPage } from "./inbox.component";

interface CustomEmailsDependencies {
	inboxAddressStore: InboxAddressStore;
	inboxAddressDomain: string;
	logError: (message: string, error?: Error) => void;
	buildBannerState: BuildBannerState;
	requireNotLocked: RequestHandler;
	requireWriteAccess: RequestHandler;
}

const AddressActionSchema = z.object({ address: InboxAddressSchema });
const CreateAddressSchema = z.object({ name: z.string() });

export function initCustomEmailsRoutes(deps: CustomEmailsDependencies): Router {
	const router = express.Router();
	const addressesPath = CUSTOM_EMAILS_PATH;
	const addressesCreateFailedPath = `${addressesPath}?error=create`;

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const addresses = await deps.inboxAddressStore.listAddressesByUserId(req.userId);
		const createFailed = req.query.error === "create";
		const nameInvalid = req.query.error === "name";
		const nameTaken = req.query.error === "name-taken";
		const createdName = AliasNameSchema.safeParse(req.query.created);
		// Banner shows whenever the cap is genuinely reached, not only after a
		// rejected create. error=limit stays OR'd in so a just-rejected create
		// still shows it even when the eventually-consistent live read
		// (listAddressesByUserId) briefly undercounts and would otherwise drop it.
		const limitReached =
			req.query.error === "limit" || countLiveCappedAddresses(addresses) >= INBOX_ADDRESS_MAX_PER_USER;
		const submittedName = typeof req.query.name === "string" ? req.query.name : "";
		sendComponent(
			req,
			res,
			Base(
				InboxPage({
					addresses,
					createFailed,
					nameInvalid,
					nameTaken,
					limitReached,
					createdName: createdName.success ? createdName.data : undefined,
					submittedName,
				}),
				await deps.buildBannerState(req),
			),
		);
	});

	router.post("/create", deps.requireNotLocked, deps.requireWriteAccess, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsed = CreateAddressSchema.safeParse(req.body);
		const name = parsed.success ? normalizeAliasName(parsed.data.name) : undefined;
		if (name === undefined) {
			res.redirect(303, `${addressesPath}?error=name`);
			return;
		}
		// Best-effort like the per-user cap — the eventually-consistent list read can
		// miss a just-minted row — so a rare racing pair may both land; harmless, since
		// the random token still keeps the two addresses distinct.
		const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
		if (owned.some((entry) => isCappedAddress(entry) && isLiveAddress(entry) && entry.name === name)) {
			res.redirect(303, `${addressesPath}?error=name-taken&name=${encodeURIComponent(name)}`);
			return;
		}
		try {
			await deps.inboxAddressStore.createAddress({
				userId,
				domain: deps.inboxAddressDomain,
				name,
				purpose: DEFAULT_INBOX_ADDRESS_PURPOSE,
			});
		} catch (error) {
			// Hitting the per-user cap is expected user behaviour, not a fault — echo
			// it back as a friendly message instead of logging an alerting-worthy error.
			if (error instanceof InboxAddressLimitReachedError) {
				res.redirect(303, `${addressesPath}?error=limit&name=${encodeURIComponent(name)}`);
				return;
			}
			deps.logError(
				"[Inbox] Failed to create a forwarding address",
				error instanceof Error ? error : new Error(String(error)),
			);
			res.redirect(303, `${addressesCreateFailedPath}&name=${encodeURIComponent(name)}`);
			return;
		}
		res.redirect(303, `${addressesPath}?created=${encodeURIComponent(name)}`);
	});

	router.post("/disable", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsed = AddressActionSchema.safeParse(req.body);
		if (parsed.success) {
			// Confirm ownership before disabling so a forged address for someone
			// else's row never reaches the (also ownership-guarded) store write.
			const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
			const target = owned.find((entry) => entry.address === parsed.data.address);
			if (target !== undefined && isCappedAddress(target)) {
				await deps.inboxAddressStore.disableAddress({ userId, address: parsed.data.address });
			}
		}
		res.redirect(303, addressesPath);
	});

	router.post(
		"/enable",
		deps.requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsed = AddressActionSchema.safeParse(req.body);
			if (parsed.success) {
				const owned = await deps.inboxAddressStore.listAddressesByUserId(userId);
				const target = owned.find((entry) => entry.address === parsed.data.address);
				if (target !== undefined && isCappedAddress(target) && !isLiveAddress(target)) {
					if (addressCapReached({ purpose: target.purpose, owned })) {
						res.redirect(303, `${addressesPath}?error=limit`);
						return;
					}
					await deps.inboxAddressStore.enableAddress({ userId, address: parsed.data.address });
				}
			}
			res.redirect(303, addressesPath);
		},
	);

	return router;
}
