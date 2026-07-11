import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

const UTM_PARAM_NAME = /^utm_/i;

const UTM_VALUE_CHARSET = /^[A-Za-z0-9._~-]*$/;

const UtmValue = z.string().regex(UTM_VALUE_CHARSET);

const UtmValueSchema = z.union([UtmValue, z.array(UtmValue)]);

function isRejectedUtmParam(entry: [string, unknown]): boolean {
	const [name, value] = entry;
	return UTM_PARAM_NAME.test(name) && !UtmValueSchema.safeParse(value).success;
}

export const utmValidationMiddleware: RequestHandler = (
	req: Request,
	res: Response,
	next: NextFunction,
) => {
	if (Object.entries(req.query).some(isRejectedUtmParam)) {
		res.status(400).end();
		return;
	}
	next();
};
