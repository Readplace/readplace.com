import assert from "node:assert/strict";
import { analyticsSaltRotation, isLambdaFunctionNotFound } from "./analytics-salt-rotation";

describe("analyticsSaltRotation", () => {
	it("lets a stack with no deployed function take any salt", () => {
		assert.equal(
			analyticsSaltRotation({ deployed: undefined, next: { salt: "salt-a", generation: 1 } }),
			"fresh-stack",
		);
	});

	it("passes the salt the deployed function already runs with", () => {
		assert.equal(
			analyticsSaltRotation({
				deployed: { salt: "salt-a", generation: 1 },
				next: { salt: "salt-a", generation: 1 },
			}),
			"unchanged",
		);
	});

	it("treats a bumped generation with the same salt as unchanged", () => {
		assert.equal(
			analyticsSaltRotation({
				deployed: { salt: "salt-a", generation: 1 },
				next: { salt: "salt-a", generation: 2 },
			}),
			"unchanged",
		);
	});

	it("approves a different salt when the generation is bumped past the deployed one", () => {
		assert.equal(
			analyticsSaltRotation({
				deployed: { salt: "salt-a", generation: 1 },
				next: { salt: "salt-b", generation: 2 },
			}),
			"approved",
		);
	});

	it("refuses a different salt under the deployed generation", () => {
		assert.equal(
			analyticsSaltRotation({
				deployed: { salt: "salt-a", generation: 1 },
				next: { salt: "salt-b", generation: 1 },
			}),
			"refused",
		);
	});

	it("refuses a different salt under a lower generation", () => {
		assert.equal(
			analyticsSaltRotation({
				deployed: { salt: "salt-a", generation: 2 },
				next: { salt: "salt-b", generation: 1 },
			}),
			"refused",
		);
	});

	it("refuses a different salt when the deployed function carries no generation", () => {
		assert.equal(
			analyticsSaltRotation({
				deployed: { salt: "salt-a", generation: undefined },
				next: { salt: "salt-b", generation: 2 },
			}),
			"refused",
		);
	});
});

describe("isLambdaFunctionNotFound", () => {
	it("recognises the provider's missing-function error", () => {
		assert.equal(
			isLambdaFunctionNotFound(
				new Error(
					"invoking aws:lambda/getFunction:getFunction: 1 error occurred:\n\t* reading Lambda Function (hutch-handler) latest version: operation error Lambda: ListVersionsByFunction, https response error StatusCode: 404, RequestID: 628e1796-e5df-43ed-b6b9-9332fc785635, ResourceNotFoundException: Function not found: arn:aws:lambda:ap-southeast-2:123456789012:function:hutch-handler",
				),
			),
			true,
		);
	});

	it("does not mistake a permission error for a missing function", () => {
		assert.equal(
			isLambdaFunctionNotFound(
				new Error(
					"reading Lambda Function (hutch-handler): operation error Lambda: GetFunction, AccessDeniedException: User is not authorized to perform: lambda:GetFunction",
				),
			),
			false,
		);
	});

	it("does not classify a thrown value that is not an Error", () => {
		assert.equal(isLambdaFunctionNotFound("ResourceNotFoundException: Function not found"), false);
	});
});
