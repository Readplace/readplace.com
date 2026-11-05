import { mcpUaClientOf, classifyBrowser, classifyDeviceClass, classifyOsFamily, isBotUserAgent } from "./user-agent";

const NATIVE_APP_USER_AGENT = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const SHARE_EXTENSION_USER_AGENT = "ShareExtension/94 CFNetwork/3860.700.1 Darwin/25.6.0";
const NATIVE_APP_BUILD_USER_AGENT = "Readplace/build-111 iOS/26.5";
const SHARE_EXTENSION_BUILD_USER_AGENT = "ShareExtension/build-111 iOS/26.5";
const ANDROID_APP_USER_AGENT = "Readplace/1 Android/17";

describe("classifyDeviceClass", () => {
	it("returns 'other' for an absent or empty User-Agent (no signal)", () => {
		expect(classifyDeviceClass(undefined)).toBe("other");
		expect(classifyDeviceClass("")).toBe("other");
	});

	it("returns 'bot' for a crawler User-Agent", () => {
		expect(classifyDeviceClass("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe("bot");
	});

	it("returns 'mobile_ios' for our own iPhone-only app, whose CFNetwork User-Agent isbot() reports as a crawler", () => {
		expect(classifyDeviceClass(NATIVE_APP_USER_AGENT)).toBe("mobile_ios");
	});

	it("returns 'mobile_ios' for our own share extension, which carries no iPhone token and would otherwise fall through to desktop", () => {
		expect(classifyDeviceClass(SHARE_EXTENSION_USER_AGENT)).toBe("mobile_ios");
	});

	it("returns 'mobile_ios' for the User-Agent the app now sets itself, which names the build and the OS instead of the CFNetwork and Darwin versions the stock string leaked", () => {
		expect(classifyDeviceClass(NATIVE_APP_BUILD_USER_AGENT)).toBe("mobile_ios");
	});

	it("returns 'mobile_ios' for the share extension's own User-Agent, which carries no iPhone token either and would otherwise fall through to desktop", () => {
		expect(classifyDeviceClass(SHARE_EXTENSION_BUILD_USER_AGENT)).toBe("mobile_ios");
	});

	it("returns 'desktop', not 'mobile_ios', for a desktop browser User-Agent carrying our native token, since the native match is anchored to the whole User-Agent", () => {
		expect(classifyDeviceClass("Mozilla/5.0 (Windows NT 10.0) Chrome/145.0 Readplace/94 CFNetwork/1.0 Darwin/1.0")).toBe("desktop");
	});

	it("returns 'mobile_android' for our own Android app, whose User-Agent carries no Android browser token", () => {
		expect(classifyDeviceClass(ANDROID_APP_USER_AGENT)).toBe("mobile_android");
	});

	it("returns 'mobile_android' for our own Android app on a codename OS release, which is what Build.VERSION.RELEASE reports before a version number is assigned", () => {
		expect(classifyDeviceClass("Readplace/1 Android/Baklava")).toBe("mobile_android");
	});

	it("returns 'mobile_android' for our own Android app on the letter-suffixed releases that shipped, 12L and Wear's 4.4W", () => {
		expect(classifyDeviceClass("Readplace/1 Android/12L")).toBe("mobile_android");
		expect(classifyDeviceClass("Readplace/1 Android/4.4W")).toBe("mobile_android");
	});

	it("returns 'bot', not 'mobile_android', for a crawler that merely mentions our Android token, since that match is anchored too", () => {
		expect(classifyDeviceClass("Googlebot/2.1 (+http://www.google.com/bot.html) Readplace/1 Android/17")).toBe("bot");
	});

	it("returns 'tablet' for an iPad", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1",
			),
		).toBe("tablet");
	});

	it("returns 'tablet' for an Android device whose UA omits the Mobile token", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("tablet");
	});

	it("returns 'mobile_ios' for an iPhone", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("mobile_ios");
	});

	it("returns 'mobile_ios' for an iPod", () => {
		expect(classifyDeviceClass("Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)")).toBe("mobile_ios");
	});

	it("returns 'mobile_android' for an Android phone (UA carries the Mobile token)", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			),
		).toBe("mobile_android");
	});

	it("returns 'desktop' for a present UA matching no mobile/tablet/bot fingerprint", () => {
		expect(
			classifyDeviceClass(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("desktop");
	});
});

describe("classifyBrowser", () => {
	it("returns 'other' for an absent or empty User-Agent (no signal)", () => {
		expect(classifyBrowser(undefined)).toBe("other");
		expect(classifyBrowser("")).toBe("other");
	});

	it("returns 'other' for a bot User-Agent even though Googlebot's smartphone UA embeds a real Chrome/ token — the isbot guard keeps a crawler from counting as Chrome", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			),
		).toBe("other");
	});

	it("returns 'other' for our own native clients, which are not browsers and must never report a browser family", () => {
		expect(classifyBrowser(NATIVE_APP_USER_AGENT)).toBe("other");
		expect(classifyBrowser(SHARE_EXTENSION_USER_AGENT)).toBe("other");
	});

	it("returns 'edge' for desktop Edge (Edg/ token on a UA that also carries Chrome/ and Safari/)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			),
		).toBe("edge");
	});

	it("returns 'edge' for Edge on Android (EdgA/ token, distinct from the desktop Edg/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0",
			),
		).toBe("edge");
	});

	it("returns 'edge' for Edge on iOS (EdgiOS/ token, which also carries a Safari/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/120.0.0.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("edge");
	});

	it("returns 'opera' for desktop Opera (OPR/ token on a Chromium UA)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
			),
		).toBe("opera");
	});

	it("returns 'opera' for Opera on iOS (OPiOS/ token, distinct from the desktop OPR/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) OPiOS/16.0.0.0 Mobile/15E148 Safari/9537.53",
			),
		).toBe("opera");
	});

	it("returns 'samsung_internet' for the Samsung Internet browser (SamsungBrowser/ token on a Chromium UA)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
			),
		).toBe("samsung_internet");
	});

	it("returns 'firefox' for desktop Firefox (Firefox/ token, no Chrome/ or Safari/)", () => {
		expect(classifyBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0")).toBe(
			"firefox",
		);
	});

	it("returns 'firefox' for Firefox on iOS (FxiOS/ token, which carries a Safari/ token — matched before Safari)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
			),
		).toBe("firefox");
	});

	it("returns 'chrome' for desktop Chrome (Chrome/ token, which also carries Safari/)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("chrome");
	});

	it("returns 'chrome' for Chrome on iOS (CriOS/ token, which carries a Safari/ token — matched before Safari)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("chrome");
	});

	it("returns 'safari' for desktop Safari (Safari/ token, matched last because every Chromium UA also carries it)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			),
		).toBe("safari");
	});

	it("returns 'safari' for mobile Safari on an iPhone", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("safari");
	});

	it("returns 'other' for an in-app webview with no browser token (an iOS Facebook webview omits the Safari/ token)", () => {
		expect(
			classifyBrowser(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.32.107;FBBV/517973715;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]",
			),
		).toBe("other");
	});
});

describe("classifyOsFamily", () => {
	it("returns 'other' for an absent or empty User-Agent", () => {
		expect(classifyOsFamily(undefined)).toBe("other");
		expect(classifyOsFamily("")).toBe("other");
	});

	it("maps our own native clients to their platform", () => {
		expect(classifyOsFamily(NATIVE_APP_USER_AGENT)).toBe("ios");
		expect(classifyOsFamily(SHARE_EXTENSION_USER_AGENT)).toBe("ios");
		expect(classifyOsFamily(ANDROID_APP_USER_AGENT)).toBe("android");
	});

	it("returns 'ereader' for Kobo, whose UA impersonates Android on Linux", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (Linux; U; Android 2.0; en-us;) AppleWebKit/538.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/538.1 (Kobo Touch 0377/4.38.21908)",
			),
		).toBe("ereader");
	});

	it("returns 'ereader' for a Kindle, whose UA carries X11 and Linux", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (X11; U; Linux armv7l like Android; en-us) AppleWebKit/531.2+ (KHTML, like Gecko) Version/5.0 Safari/533.2+ Kindle/3.0+",
			),
		).toBe("ereader");
	});

	it("returns 'ereader' for PocketBook, whose UA carries Linux", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (Linux; Ubuntu 14.04 like Android 4.4) AppleWebKit/537.36 Chromium/35.0.1870.2 Mobile Safari/537.36 PocketBook/631",
			),
		).toBe("ereader");
	});

	it("returns 'other' for Googlebot even though its smartphone UA carries Android", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			),
		).toBe("other");
	});

	it("returns 'chromeos' for a Chromebook, whose UA carries X11 and Linux-like tokens", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			),
		).toBe("chromeos");
	});

	it("returns 'android' for an Android phone, whose UA carries Linux", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
			),
		).toBe("android");
	});

	it("returns 'ios' for an iPhone, an iPad and an iPod, whose UAs carry 'like Mac OS X'", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("ios");
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("ios");
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
			),
		).toBe("ios");
	});

	it("returns 'windows' for a Windows browser", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
			),
		).toBe("windows");
	});

	it("returns 'macos' for a Mac, including an iPad in desktop mode that reports itself as one", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			),
		).toBe("macos");
	});

	it("returns 'linux' for a desktop Linux browser on an X11 or Linux token", () => {
		expect(
			classifyOsFamily("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"),
		).toBe("linux");
		expect(
			classifyOsFamily("Mozilla/5.0 (X11; FreeBSD amd64; rv:121.0) Gecko/20100101 Firefox/121.0"),
		).toBe("linux");
		expect(
			classifyOsFamily("Mozilla/5.0 (Wayland; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
		).toBe("linux");
	});

	it("returns 'other' for a browser UA naming no platform in the gated or never-gated sets", () => {
		expect(
			classifyOsFamily(
				"Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15",
			),
		).toBe("other");
	});
});

describe("isBotUserAgent", () => {
	it("reports a crawler as a bot", () => {
		expect(isBotUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
	});

	it("does not report our own iPhone app as a bot, which is the whole reason this predicate exists rather than a bare isbot", () => {
		expect(isBotUserAgent(NATIVE_APP_USER_AGENT)).toBe(false);
	});

	it("does not report our own share extension as a bot, whose User-Agent isbot() happens to spare today and must keep being spared", () => {
		expect(isBotUserAgent(SHARE_EXTENSION_USER_AGENT)).toBe(false);
	});

	it("does not report the User-Agent our iPhone app now sets itself as a bot — isbot() reads it as a crawler off the same ^read rule that condemned the stock CFNetwork string, so dropping the stock shape never dropped the need for the exemption", () => {
		expect(isBotUserAgent(NATIVE_APP_BUILD_USER_AGENT)).toBe(false);
	});

	it("does not report the share extension's own User-Agent as a bot, which isbot() happens to spare today and must keep being spared", () => {
		expect(isBotUserAgent(SHARE_EXTENSION_BUILD_USER_AGENT)).toBe(false);
	});

	it("does not report a real browser as a bot", () => {
		expect(
			isBotUserAgent(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
			),
		).toBe(false);
	});

	it("matches isbot on a missing User-Agent so a caller swapping to this predicate changes nothing but the native-client case", () => {
		expect(isBotUserAgent(undefined)).toBe(false);
	});

	it("still reports our own User-Agent with anything appended to it as a bot, so the exemption cannot be worn by a request that merely opens with it", () => {
		expect(isBotUserAgent(`${NATIVE_APP_USER_AGENT} extra`)).toBe(true);
	});

	it("still reports a User-Agent that merely starts with our product name as a bot", () => {
		expect(isBotUserAgent("ReadplaceBot/94 CFNetwork/3860.700.1 Darwin/25.6.0")).toBe(true);
	});

	it("still reports a build segment that is not the integer CFBundleVersion carries as a bot", () => {
		expect(isBotUserAgent("Readplace/beta CFNetwork/1.0 Darwin/1.0")).toBe(true);
	});

	it("still reports the new shape as a bot when its build is not the integer CFBundleVersion carries, so the literal `build-` prefix is not what earns the exemption", () => {
		expect(isBotUserAgent("Readplace/build-abc iOS/26.5")).toBe(true);
	});

	it("still reports the new shape stripped of its platform token as a bot, since a product and a build alone name no client we ship", () => {
		expect(isBotUserAgent("Readplace/build-111")).toBe(true);
	});

	it("still reports the new shape with anything appended to it as a bot, so the added alternative is anchored to the whole User-Agent exactly as the stock one is", () => {
		expect(isBotUserAgent(`${NATIVE_APP_BUILD_USER_AGENT} extra`)).toBe(true);
	});

	it("still reports a cross of the two shapes — the new build segment carrying the stock CFNetwork and Darwin tokens — as a bot, proving the exemption is two whole alternatives and not a cross-product of their halves", () => {
		expect(isBotUserAgent("Readplace/build-111 CFNetwork/1.0 Darwin/1.0")).toBe(true);
	});

	it("does not report our own Android app on a codename OS release as a bot, which isbot() reads as a crawler off its ^read rule", () => {
		expect(isBotUserAgent("Readplace/1 Android/Baklava")).toBe(false);
	});

	it("still reports an Android User-Agent whose app version is not the integer versionCode carries as a bot", () => {
		expect(isBotUserAgent("Readplace/beta Android/16")).toBe(true);
	});
});

describe("mcpUaClientOf", () => {
	it.each([
		["openai-mcp/1.0.0", "openai"],
		["openai-connectors-oauth/1.0", "openai"],
		["openai-mcp/1.0.0 (Codex)", "codex"],
		["Claude-User", "claude"],
		["Claude-User (claude-code/2.1; +https://support.anthropic.com/)", "claude"],
		[undefined, "other"],
		["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/145.0", "other"],
		["Mozilla/5.0 openai-mcp/1.0.0", "other"],
		["Claude-UserBot", "other"],
	])("classifies %s as %s, never keeping the raw User-Agent", (userAgent, expected) => {
		expect(mcpUaClientOf(userAgent)).toBe(expected);
	});
});
