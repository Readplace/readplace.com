import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('backfill', Path(__file__).with_name('backfill-full-crawl.py'))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


class EvidenceTest(unittest.TestCase):
    def test_only_latest_proven_admission_qualifies(self):
        row = {'url': {'S': 'site.test/a'}, 'savedAt': {'S': '2026-11-05'}, 'crawlFailedAt': {'S': '2026-11-07'}}
        full = {'url': 'site.test/a', 'timestamp': '2026-11-06', 'meteredLegs': 'run', 'crawlPending': {'kind': 'marked'}}
        history = {'coverageStart': '2026-11-01', 'coverageEnd': '2026-11-08', 'admissions': [full]}
        self.assertEqual(backfill.evidence(row, history), '2026-11-06')
        history['admissions'].append({**full, 'timestamp': '2026-11-06T12:00:00Z', 'meteredLegs': 'deferred'})
        self.assertIsNone(backfill.evidence(row, history))
        history['admissions'] = [full]
        history['coverageStart'] = '2026-11-06'
        self.assertIsNone(backfill.evidence(row, history))
        history['coverageStart'] = '2026-11-01'
        row['meteredLegsDeferredSince'] = {'S': '2026-11-06'}
        self.assertIsNone(backfill.evidence(row, history))


if __name__ == '__main__':
    unittest.main()
