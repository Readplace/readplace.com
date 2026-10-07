#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const {
  ConditionalCheckFailedException,
  createDynamoDocumentClient,
  defineDynamoTable,
  dynamoField,
} = require('@packages/hutch-storage-client');
const { HutchLogger, consoleLogger } = require('@packages/hutch-logger');

for (const name of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete process.env[name];

const logger = HutchLogger.from(consoleLogger);
const USAGE = 'usage: copy-gmail-mappings.js <staging|prod> [plan|apply|verify|rollback-plan|rollback-apply]';
const MAPPING_FIELDS = ['addedToFilterAt', 'mappedAddress', 'additionalMappedAddresses', 'mappedAt', 'deliveryMode'];

const MappingFields = {
  addedToFilterAt: dynamoField(z.string()),
  mappedAddress: dynamoField(z.string()),
  additionalMappedAddresses: dynamoField(z.array(z.string())),
  mappedAt: dynamoField(z.string()),
  deliveryMode: dynamoField(z.string()),
};
const SenderRow = z.object({ userId: z.string(), senderEmail: z.string(), ...MappingFields });
const MappingRow = z.object({
  userId: z.string(),
  mappingKey: z.string(),
  accountEmail: z.string(),
  senderEmail: z.string(),
  ...MappingFields,
});
const ConnectionRow = z.object({ userId: z.string(), accountEmail: dynamoField(z.string()) });

function tableNames(env) {
  const stack = fs.readFileSync(path.resolve(__dirname, '..', `Pulumi.${env}.yaml`), 'utf8');
  const read = (key) => {
    const match = stack.match(new RegExp(`^\\s*hutch:${key}: (\\S+)$`, 'm'));
    assert.ok(match, `${key} is not set in Pulumi.${env}.yaml`);
    return match[1];
  };
  return {
    senders: read('dynamodbGmailSendersTable'),
    connections: read('dynamodbGmailConnectionsTable'),
    mappings: read('dynamodbGmailMappingsTable'),
  };
}

function redact(email) {
  return `${email.slice(0, 1)}…${email.slice(email.indexOf('@'))}`;
}

function describe(row) {
  return { userId: row.userId, mapping: `${redact(row.accountEmail)}#${redact(row.senderEmail)}` };
}

function mappingFieldsOf(row) {
  return Object.fromEntries(MAPPING_FIELDS.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]));
}

async function scanAll(table) {
  const items = [];
  let lastEvaluatedKey;
  do {
    const page = await table.scan(lastEvaluatedKey === undefined ? undefined : { ExclusiveStartKey: lastEvaluatedKey });
    items.push(...page.items);
    lastEvaluatedKey = page.lastEvaluatedKey;
  } while (lastEvaluatedKey !== undefined);
  return items;
}

async function connectedAccountOf(connections, userId) {
  return (await connections.get({ userId }, { consistentRead: true }))?.accountEmail;
}

async function planForward({ senders, connections }) {
  const planned = [];
  const skipped = [];
  for (const row of await scanAll(senders)) {
    if (row.addedToFilterAt === undefined && row.mappedAddress === undefined) continue;
    const accountEmail = await connectedAccountOf(connections, row.userId);
    if (accountEmail === undefined) {
      skipped.push({ userId: row.userId, sender: redact(row.senderEmail), reason: 'no connection with a recorded Gmail address' });
      continue;
    }
    planned.push({
      userId: row.userId,
      mappingKey: `${accountEmail}#${row.senderEmail}`,
      accountEmail,
      senderEmail: row.senderEmail,
      ...mappingFieldsOf(row),
    });
  }
  return { planned, skipped };
}

async function forward(tables, apply) {
  const { planned, skipped } = await planForward(tables);
  logger.info('[copy-gmail-mappings] forward plan', { toCopy: planned.length, skipped: skipped.length });
  for (const skip of skipped) logger.warn('[copy-gmail-mappings] skipped', skip);
  for (const row of planned) {
    if (!apply) {
      logger.info('[copy-gmail-mappings] would create', { ...describe(row), fields: Object.keys(mappingFieldsOf(row)) });
      continue;
    }
    try {
      await tables.mappings.put({ Item: row, ConditionExpression: 'attribute_not_exists(mappingKey)' });
      logger.info('[copy-gmail-mappings] created', describe(row));
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      logger.info('[copy-gmail-mappings] already present, left untouched', describe(row));
    }
  }
  if (!apply) logger.info('[copy-gmail-mappings] dry run, nothing written');
}

async function verify(tables) {
  const { planned, skipped } = await planForward(tables);
  const current = new Map((await scanAll(tables.mappings)).map((row) => [`${row.userId}\u0000${row.mappingKey}`, row]));
  const keyOf = (row) => `${row.userId}\u0000${row.mappingKey}`;
  const missing = planned.filter((row) => !current.has(keyOf(row)));
  const differing = planned.filter((row) => {
    const target = current.get(keyOf(row));
    return target !== undefined && JSON.stringify(mappingFieldsOf(target)) !== JSON.stringify(mappingFieldsOf(row));
  });
  const expected = new Set(planned.map(keyOf));
  const onlyInNew = [...current.values()].filter((row) => !expected.has(keyOf(row)));
  logger.info('[copy-gmail-mappings] verify', {
    source: planned.length,
    target: current.size,
    skipped: skipped.length,
    missing: missing.length,
    differing: differing.length,
    onlyInNew: onlyInNew.length,
  });
  for (const skip of skipped) logger.warn('[copy-gmail-mappings] skipped', skip);
  for (const row of missing) logger.warn('[copy-gmail-mappings] missing from the mappings table', describe(row));
  for (const row of differing) {
    const target = current.get(keyOf(row));
    logger.warn('[copy-gmail-mappings] differs between the tables', {
      ...describe(row),
      sendersMappedAt: row.mappedAt,
      mappingsMappedAt: target.mappedAt,
    });
  }
  for (const row of onlyInNew) {
    logger.warn('[copy-gmail-mappings] only in the mappings table', { ...describe(row), addedToFilterAt: row.addedToFilterAt, mappedAt: row.mappedAt });
  }
  if (skipped.length + missing.length + differing.length + onlyInNew.length > 0) process.exitCode = 1;
}

async function rollback(tables, apply) {
  const rows = await scanAll(tables.mappings);
  logger.info('[copy-gmail-mappings] rollback plan', { mappings: rows.length });
  for (const row of rows) {
    const accountEmail = await connectedAccountOf(tables.connections, row.userId);
    if (accountEmail !== row.accountEmail) {
      logger.warn('[copy-gmail-mappings] skipped, not the connected Gmail account', describe(row));
      continue;
    }
    const present = MAPPING_FIELDS.filter((field) => row[field] !== undefined);
    const absent = MAPPING_FIELDS.filter((field) => row[field] === undefined);
    const clauses = [];
    if (present.length > 0) clauses.push(`SET ${present.map((field) => `${field} = :${field}`).join(', ')}`);
    if (absent.length > 0) clauses.push(`REMOVE ${absent.join(', ')}`);
    const update = {
      Key: { userId: row.userId, senderEmail: row.senderEmail },
      UpdateExpression: clauses.join(' '),
      ...(present.length > 0 ? { ExpressionAttributeValues: Object.fromEntries(present.map((field) => [`:${field}`, row[field]])) } : {}),
    };
    if (!apply) {
      logger.info('[copy-gmail-mappings] would write back', { ...describe(row), fields: present });
      continue;
    }
    await tables.senders.update(update);
    logger.info('[copy-gmail-mappings] written back to the senders table', describe(row));
  }
  if (!apply) logger.info('[copy-gmail-mappings] dry run, nothing written');
}

async function main() {
  const [env, mode = 'plan'] = process.argv.slice(2);
  assert.ok(env === 'staging' || env === 'prod', USAGE);
  const names = tableNames(env);
  const client = createDynamoDocumentClient({ region: 'ap-southeast-2' });
  const tables = {
    senders: defineDynamoTable({ client, tableName: names.senders, schema: SenderRow }),
    connections: defineDynamoTable({ client, tableName: names.connections, schema: ConnectionRow }),
    mappings: defineDynamoTable({ client, tableName: names.mappings, schema: MappingRow }),
  };
  logger.info('[copy-gmail-mappings] start', { env, mode, ...names });
  const run = {
    plan: () => forward(tables, false),
    apply: () => forward(tables, true),
    verify: () => verify(tables),
    'rollback-plan': () => rollback(tables, false),
    'rollback-apply': () => rollback(tables, true),
  }[mode];
  assert.ok(run, USAGE);
  await run();
}

main();
