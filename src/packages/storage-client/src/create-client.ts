import { DynamoDBClient, type DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Construct a DynamoDB document client. Composition roots should use this
 * factory instead of importing `@aws-sdk/lib-dynamodb` directly so the
 * lint fence can enforce that the gateway is the single seam.
 */
export function createDynamoDocumentClient(config?: DynamoDBClientConfig): DynamoDBDocumentClient {
	return DynamoDBDocumentClient.from(new DynamoDBClient(config ?? {}));
}
