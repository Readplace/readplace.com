import { captureOAuthBody, oauthRequestBody } from "./request-body";

it("preserves the exact received bytes independently of parser buffer changes", () => {
	const request = {};
	const received = Buffer.from("scope=read%20write&value=%2B");
	captureOAuthBody(request, {}, received);
	received.fill(0);
	expect(oauthRequestBody(request).toString()).toBe("scope=read%20write&value=%2B");
});

it("fails closed when the body parser did not capture the signed request", () => {
	expect(() => oauthRequestBody({})).toThrow("OAuth request body was not captured");
});
