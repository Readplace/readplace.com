import { VIEWER_PATH_HEADER, EDGE_SECRET_HEADER, VIEWER_IP_HEADER, VIEWER_HOST_HEADER } from "@packages/viewer-identity";
import { edgeRequest, gatewayEvent } from "./viewer-path.test-helper";

it.each(["/view/", "/view/https://example.com/a//b", "/VIEW/example.com/a;b,c+%E2%98%83/%2F/%zz"])("moves the exact encoded reader path into a trusted header: %s", (uri) => {
	const result = edgeRequest(uri, { [VIEWER_PATH_HEADER]: { value: "spoof" }, [EDGE_SECRET_HEADER]: { value: "spoof" } });
	expect(result.uri).toBe("/view");
	expect(result.headers[VIEWER_PATH_HEADER].value).toBe(uri);
	expect(result.headers[EDGE_SECRET_HEADER]).toBeUndefined();
	expect(result.headers[VIEWER_HOST_HEADER].value).toBe("localhost:3000");
	expect(result.headers[VIEWER_IP_HEADER].value).toBe("203.0.113.9");
	expect(result.method).toBe("POST");
	expect(result.body).toEqual({ data: "payload" });
	expect(result.querystring).toEqual({ x: { value: "one", multiValue: [{ value: "one" }, { value: "" }] } });
});

it.each(["/", "/view", "/VIEW", "/api/a//b", "/view/é", "/view/a b", "/view/a\r\nb", "/view/a\x7f", "/view/a?b", "/view/a#b"])("strips caller preservation and retains unsupported transport: %j", (uri) => {
	const result = edgeRequest(uri, { [VIEWER_PATH_HEADER]: { value: "spoof" } });
	expect(result.uri).toBe(uri);
	expect(result.headers[VIEWER_PATH_HEADER]).toBeUndefined();
});

it.each([5000, 8000])("adds constant request-size overhead for a %i-byte path with cookies", (size) => {
	const path = `/view/example.com/${"a".repeat(size - 17)}`;
	const cookie = `hutch_sid=${"s".repeat(300)}; preferences=${"p".repeat(600)}`;
	const event = gatewayEvent(path, { headers: { cookie } });
	const transportedBytes = event.rawPath.length + event.headers[VIEWER_PATH_HEADER].length + cookie.length;
	expect(transportedBytes - (path.length + cookie.length)).toBe(5);
	expect(event.headers.cookie).toBe(cookie);
});
