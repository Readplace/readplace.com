import type { Request } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import { initRecordAudienceEvent } from "./record-audience-event";

const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const NATIVE_APP_USER_AGENT = "Readplace/94 CFNetwork/3860.700.1 Darwin/25.6.0";

interface RecordedEvent {
	event: string;
}

function createCapturingLogger(): {
	logger: HutchLogger.Typed<RecordedEvent>;
	captured: RecordedEvent[];
} {
	const captured: RecordedEvent[] = [];
	const logger: HutchLogger.Typed<RecordedEvent> = {
		info: (data) => { captured.push(data); },
		error: () => {},
		warn: () => {},
		debug: () => {},
	};
	return { logger, captured };
}

function reqWith(userAgent: string | undefined): Request {
	return {
		get(name: string): string | undefined {
			return name.toLowerCase() === "user-agent" ? userAgent : undefined;
		},
	} as Request;
}

function recordedFor(userAgent: string | undefined): RecordedEvent[] {
	const { logger, captured } = createCapturingLogger();
	initRecordAudienceEvent({ logger })(reqWith(userAgent), { event: "article_read" });
	return captured;
}

describe("initRecordAudienceEvent", () => {
	it("logs the event a browser produced", () => {
		expect(recordedFor(BROWSER_USER_AGENT)).toEqual([{ event: "article_read" }]);
	});

	it("logs the event a native app produced, so an in-app read is still an audience event", () => {
		expect(recordedFor(NATIVE_APP_USER_AGENT)).toEqual([{ event: "article_read" }]);
	});

	it("drops the event a crawler produced, which is the whole point of routing every emitter through this sink", () => {
		expect(recordedFor("Googlebot/2.1 (+http://www.google.com/bot.html)")).toEqual([]);
	});

	it("drops the event a request with no User-Agent produced, so a scripted call cannot inflate an audience widget", () => {
		expect(recordedFor(undefined)).toEqual([]);
	});
});
