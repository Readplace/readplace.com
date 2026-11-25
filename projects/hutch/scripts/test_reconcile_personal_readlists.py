import gzip
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("migration", Path(__file__).with_name("reconcile-personal-readlists.py"))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def row(url, kind, **extra):
    return {
        "userId": {"S": "reader"}, "url": {"S": url}, "status": {"S": "unread"},
        "savedAt": {"S": "2026-10-02T00:00:00.000Z"}, "provenance": {"M": {"kind": {"S": kind}}},
        **extra,
    }


class ReconciliationTest(unittest.TestCase):
    def test_interrupted_file_replay_skips_later_changes_and_deletions(self):
        export = "export-id"
        snapshot = row("media/private", "upload", handPickedAt={"S": "2026-10-01T11:00:00+11:00"})

        class ConditionalFailure(Exception):
            def __init__(self, current):
                self.response = {"Item": current}

        db = Mock()
        db.exceptions.ConditionalCheckFailedException = ConditionalFailure
        migrated = {
            "personalMigration": {"S": export}, "personalScope": {"S": "reader#picked#unread"},
            "personalDecision": {"S": "2026-10-01T00:00:00.000Z#"},
        }
        for current, expected in [
            (migrated, "picked"), ({}, "skipped-changed"),
            ({**migrated, "personalDecision": {"S": "later-request"}}, "skipped-changed"),
            ({**migrated, "personalScope": {"S": "reader#picked#read"}}, "skipped-changed"),
        ]:
            with self.subTest(current=current):
                db.update_item.side_effect = ConditionalFailure(current)
                self.assertEqual(migration.reconcile_item(db, "table", snapshot, "picked", export), expected)

    def test_full_export_dry_run_then_restart(self):
        arn = "arn:aws:dynamodb:test:123:table/saves/export/export-id"
        ambiguous = row("example.org/old", "client", handPickedAt={"S": "2026-10-01T00:00:00.000Z"})
        upload = row("media/private", "upload", handPickedAt={"S": "2026-01-01T00:00:00.000Z"})
        imported = row("example.org/imported", "import")
        held = row("example.org/held", "email", userId={"S": "reader#removed"})
        data = [ambiguous, upload, imported, held]
        db, s3 = Mock(), Mock()
        db.describe_export.return_value = {"ExportDescription": {
            "ExportStatus": "COMPLETED", "ExportFormat": "DYNAMODB_JSON", "ExportType": "FULL_EXPORT",
            "TableArn": arn.split("/export")[0], "TableId": "table-id", "S3Bucket": "private-bucket",
            "ExportManifest": "summary",
        }}
        db.describe_table.return_value = {"Table": {"TableId": "table-id", "GlobalSecondaryIndexes": [
            {"IndexName": "personalScope-personalOrder-index", "IndexStatus": "ACTIVE"}
        ]}}
        files = {"summary": json.dumps({"exportArn": arn, "manifestFilesS3Key": "files", "itemCount": 4}).encode(),
                 "files": b'{"dataFileS3Key":"rows"}',
                 "rows": gzip.compress(b"\n".join(json.dumps({"Item": item}).encode() for item in data))}
        def get_object(**request):
            self.assertEqual(request["ExpectedBucketOwner"], "123")
            body = io.BytesIO(files[request["Key"]])
            body.iter_lines = body.readlines
            return {"Body": body}
        s3.get_object.side_effect = get_object
        def client(name, **_):
            return db if name == "dynamodb" else s3

        with tempfile.TemporaryDirectory() as tmp:
            args = SimpleNamespace(export_arn=arn, checkpoint=tmp + "/progress.sqlite", apply=True)
            with self.assertRaisesRegex(ValueError, "dry count"):
                migration.run(args, client=client)
            args.apply = False
            report = io.StringIO()
            with redirect_stdout(report):
                migration.run(args, client=client)
            self.assertEqual(json.loads(report.getvalue())["counts"], {"picked": 1, "uncertain": 1, "all": 1, "excluded": 1})
            db.update_item.assert_not_called()
            args.apply = True
            with redirect_stdout(io.StringIO()):
                migration.run(args, client=client)
                migration.run(args, client=client)
            self.assertEqual(db.update_item.call_count, 2)
            uncertain, picked = [call.kwargs for call in db.update_item.call_args_list]
            self.assertNotIn(":picked", uncertain["ExpressionAttributeValues"])
            self.assertEqual(picked["ExpressionAttributeValues"][":picked"], upload["handPickedAt"])
            self.assertEqual(picked["ExpressionAttributeValues"][":decision"]["S"], upload["handPickedAt"]["S"] + "#")
            self.assertIn("attribute_not_exists(#personalDecision)", picked["ConditionExpression"])
            self.assertIn("#savedAt = :savedAt", picked["ConditionExpression"])


if __name__ == "__main__":
    unittest.main()
