import express from "express";
import request from "supertest";
import { SIREN_MEDIA_TYPE } from "./api/siren";
import { forBearerSirenRequests } from "./bearer-siren-requests.middleware";

function recordingApp(calls: string[]) {
	const app = express();
	app.use(
		forBearerSirenRequests((_req, res) => {
			calls.push("handler");
			res.sendStatus(204);
		}),
	);
	app.use((_req, res) => {
		calls.push("next");
		res.sendStatus(204);
	});
	return app;
}

describe("forBearerSirenRequests", () => {
	it("runs the handler for a Siren request that carries a bearer token", async () => {
		const calls: string[] = [];
		await request(recordingApp(calls)).post("/upload").set("Accept", SIREN_MEDIA_TYPE).set("Authorization", "Bearer x");
		expect(calls).toEqual(["handler"]);
	});

	it("passes a Siren request with no Authorization header straight on", async () => {
		const calls: string[] = [];
		await request(recordingApp(calls)).post("/upload").set("Accept", SIREN_MEDIA_TYPE);
		expect(calls).toEqual(["next"]);
	});

	it("passes an HTML request that carries a bearer token straight on", async () => {
		const calls: string[] = [];
		await request(recordingApp(calls)).post("/upload").set("Accept", "text/html").set("Authorization", "Bearer x");
		expect(calls).toEqual(["next"]);
	});
});
