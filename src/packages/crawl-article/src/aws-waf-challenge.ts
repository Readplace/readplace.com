export function isAwsWafChallenge(response: Response): boolean {
	const action = response.headers.get("x-amzn-waf-action");
	return action === "challenge" || action === "captcha";
}
