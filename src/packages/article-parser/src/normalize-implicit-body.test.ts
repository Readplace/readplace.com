import { parseHTML } from "linkedom";
import { normalizeImplicitBody } from "./normalize-implicit-body";

describe("normalizeImplicitBody", () => {
	it("gives a page with no <body> a head for its metadata and a body for its flow content", () => {
		const { document } = parseHTML(
			'<html><base href="https://hex.ooo/"><meta charset="utf-8"><title>Hex</title><link rel="stylesheet" href="/library.css"><style>main{margin:0}</style><script src="/menu.js"></script><nav>Menu</nav><main><p>Post body</p></main></html>',
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head><base href="https://hex.ooo/"><meta charset="utf-8"><title>Hex</title><link rel="stylesheet" href="/library.css"><style>main{margin:0}</style><script src="/menu.js"></script></head><body><nav>Menu</nav><main><p>Post body</p></main></body></html>',
		);
	});

	it("moves the flow content of a never-closed <head> into the body, keeping its metadata", () => {
		const { document } = parseHTML(
			'<html><head><title>Unplanned</title><meta name="description" content="Obsolescence"><h1>Unplanned obsolescence</h1><p>Post body</p></html>',
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			'<html><head><title>Unplanned</title><meta name="description" content="Obsolescence"></head><body><h1>Unplanned obsolescence</h1><p>Post body</p></body></html>',
		);
	});

	it("leaves a page whose head and body are already in place exactly as it was", () => {
		const { document } = parseHTML(
			"<html><head><title>Post</title></head><body><article><p>Post body</p></article></body></html>",
		);

		normalizeImplicitBody(document);

		expect(document.documentElement.outerHTML).toBe(
			"<html><head><title>Post</title></head><body><article><p>Post body</p></article></body></html>",
		);
	});
});
