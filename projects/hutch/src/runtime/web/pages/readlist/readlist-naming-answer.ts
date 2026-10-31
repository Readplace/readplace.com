import type { Request, Response } from "express";
import { wantsSiren } from "../../content-negotiation";
import { type HxLocationScroll, hxLocationToMain } from "../../hx-location";
import { type ReadlistRefusal, refuseOverSiren } from "./readlist-siren-refusal";

type SirenAnswer = { location: string } | ReadlistRefusal;

export type ReadlistNaming =
	| { landing: string; scroll: HxLocationScroll; announcement?: string; siren?: SirenAnswer }
	| { refusal: string; form: () => string; siren?: SirenAnswer };

export function answerReadlistNaming(
	req: Request,
	res: Response,
	answer: { dialogId: string; naming: ReadlistNaming },
): void {
	const { naming } = answer;
	if (naming.siren !== undefined && wantsSiren(req)) {
		if ("location" in naming.siren) {
			res.redirect(303, naming.siren.location);
			return;
		}
		refuseOverSiren(res, naming.siren);
		return;
	}
	if (req.get("HX-Request") !== "true") {
		res.redirect(303, "landing" in naming ? naming.landing : naming.refusal);
		return;
	}
	if (!("landing" in naming)) {
		res.status(422).type("html").send(naming.form());
		return;
	}
	res.set(
		"HX-Location",
		hxLocationToMain({ path: naming.landing, source: `#${answer.dialogId}`, scroll: naming.scroll }),
	);
	if (naming.announcement === undefined) {
		res.status(204).end();
		return;
	}
	res.type("text/plain").send(naming.announcement);
}
