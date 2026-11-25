"""Reconcile a completed FULL_EXPORT (DYNAMODB_JSON) of the user-articles table.

Use the same --checkpoint and --export-arn for the default dry run and --apply.
Only aggregate counts and completed S3 object names are checkpointed locally.

Keep the Hutch stack setting handPickedHomeEnabled false while deploying compatible
consumers, the sparse index, and then the writers. Reconcile a private export taken
after the writers are live. Compare the dry and applied totals, including records
skipped after newer reader changes. Remove the temporary export and checkpoint
according to their retention policy once the totals have been reconciled.

Enable handPickedHomeEnabled after reconciliation, then release clients. Setting
it false again returns the web home to All and preserves recorded choices.
bulkArticlesEnabled controls the separate bulk release. Verify preparation,
execution, and restoration for more than 16 queue steps in staging before rollout.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import sqlite3



def string(item, key):
    return item.get(key, {}).get("S")


def normalized_instant(instant):
    value = datetime.fromisoformat(instant.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("Expected a timestamp with an explicit timezone")
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def classify(item):
    owner, url = string(item, "userId"), string(item, "url")
    if not owner or not url or "#queue/" in owner or owner.endswith("#removed"):
        return "excluded"
    if url.startswith("readplace:") or "highlightOf" in item or "removedByJobId" in item:
        return "excluded"
    if string(item, "status") not in ("read", "unread") or not string(item, "savedAt"):
        return "excluded"
    if any(key in item for key in ("personalDecision", "personalScope", "personalPickedAt", "bulkSave")):
        return "already-classified"
    kind = string(item.get("provenance", {}).get("M", {}), "kind")
    if kind == "upload" and string(item, "handPickedAt"):
        return "picked"
    if kind in ("import", "founder-seed", "hn-suggestion") or url.startswith("inbox/"):
        return "all"
    if kind == "email" and "handPickedAt" not in item:
        return "all"
    return "uncertain"


def reconcile_item(db, table, item, scope, export_id):
    owner, url, status = (string(item, key) for key in ("userId", "url", "status"))
    picked_at = string(item, "handPickedAt") if scope == "picked" else None
    order_at = (string(item, "readAt") if status == "read" else None) or picked_at or string(item, "savedAt")
    order_at = normalized_instant(order_at)
    digest = hashlib.sha256(url.encode()).hexdigest()[:32]
    key = {name: item[name] for name in ("userId", "url")}
    values = {":scope": {"S": f"{owner}#{scope}#{status}"}, ":order": {"S": f"{order_at}#{digest}"},
              ":export": {"S": export_id}}
    names, guards = {}, []
    for name in ("savedAt", "status", "statusRevision", "readAt", "restoredAt", "provenance", "handPickedAt",
                 "personalScope", "personalPickedAt", "personalDecision", "personalMigration", "bulkSave", "unknownOrigin"):
        alias = "#" + name
        names[alias] = name
        if name in item:
            values[":" + name] = item[name]
            guards.append(f"{alias} = :{name}")
        else:
            guards.append(f"attribute_not_exists({alias})")
    update = "SET #personalScope = :scope, personalOrder = :order, #personalMigration = :export"
    if scope == "uncertain":
        values[":unknown"] = {"BOOL": True}
        update += ", #unknownOrigin = :unknown"
    if picked_at:
        values[":picked"] = {"S": normalized_instant(picked_at)}
        values[":decision"] = {"S": normalized_instant(picked_at) + "#"}
        update += ", #personalPickedAt = :picked, #personalDecision = :decision"
    try:
        db.update_item(TableName=table, Key=key, UpdateExpression=update,
                       ConditionExpression=" AND ".join(guards), ExpressionAttributeNames=names,
                       ExpressionAttributeValues=values, ReturnValuesOnConditionCheckFailure="ALL_OLD")
    except db.exceptions.ConditionalCheckFailedException as error:
        current = error.response.get("Item", {})
        if (string(current, "personalMigration") != export_id or current.get("personalDecision") != values.get(":decision")
                or string(current, "personalScope") != values[":scope"]["S"]):
            return "skipped-changed"
    return scope


def run(args, client=None):
    if client is None:
        import boto3
        client = boto3.client
    region = args.export_arn.split(":")[3]
    db = client("dynamodb", region_name=region)
    export = db.describe_export(ExportArn=args.export_arn)["ExportDescription"]
    if (export["ExportStatus"], export["ExportFormat"], export["ExportType"]) != ("COMPLETED", "DYNAMODB_JSON", "FULL_EXPORT"):
        raise ValueError("A completed full DynamoDB JSON export is required")
    table = export["TableArn"].split("/")[-1]
    current = db.describe_table(TableName=table)["Table"]
    if current["TableId"] != export["TableId"]:
        raise ValueError("The exported table was replaced")
    if args.apply and not any(index["IndexName"] == "personalScope-personalOrder-index" and
                              index["IndexStatus"] == "ACTIVE" for index in current["GlobalSecondaryIndexes"]):
        raise ValueError("The personal readlist index must be active")
    s3 = client("s3", region_name=region)
    def get(key):
        return s3.get_object(Bucket=export["S3Bucket"], Key=key,
                             ExpectedBucketOwner=export.get("S3BucketOwner") or args.export_arn.split(":")[4])["Body"]
    summary = json.load(get(export["ExportManifest"]))
    if summary["exportArn"] != args.export_arn:
        raise ValueError("Manifest belongs to a different export")
    files = [json.loads(line)["dataFileS3Key"] for line in get(summary["manifestFilesS3Key"]).iter_lines() if line]
    mode = "apply" if args.apply else "dry"
    with sqlite3.connect(args.checkpoint) as checkpoint:
        checkpoint.execute("CREATE TABLE IF NOT EXISTS chunks (export, mode, file, counts, PRIMARY KEY(export, mode, file))")
        def completed(mode):
            return dict(checkpoint.execute("SELECT file, counts FROM chunks WHERE export=? AND mode=?", (args.export_arn, mode)))
        if args.apply:
            dry = completed("dry")
            dry_count = sum(sum(json.loads(counts).values()) for counts in dry.values())
            if set(dry) != set(files) or dry_count != summary["itemCount"]:
                raise ValueError("Complete the dry count against this export first")
        prior = completed(mode)
        totals = Counter()
        for key in files:
            if key in prior:
                totals.update(json.loads(prior[key]))
                continue
            counts = Counter()
            with gzip.GzipFile(fileobj=get(key)) as rows:
                for line in rows:
                    item = json.loads(line)["Item"]
                    result = classify(item)
                    if args.apply and result in ("uncertain", "picked"):
                        result = reconcile_item(db, table, item, result, args.export_arn)
                    counts[result] += 1
            checkpoint.execute("INSERT INTO chunks VALUES (?,?,?,?)", (args.export_arn, mode, key, json.dumps(counts)))
            checkpoint.commit()
            totals.update(counts)
        if sum(totals.values()) != summary["itemCount"]:
            raise ValueError("Processed count differs from export manifest")
        print(json.dumps({"mode": mode, "counts": totals}, sort_keys=True))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--export-arn", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--apply", action="store_true")
    run(parser.parse_args())
