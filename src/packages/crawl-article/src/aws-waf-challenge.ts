export function isAwsWafChallenge(response: Pick<Response, "headers">): boolean {
	const action = response.headers.get("x-amzn-waf-action");
	return action === "challenge" || action === "captcha";
}
