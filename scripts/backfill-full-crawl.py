import argparse
import json
import subprocess
from collections import Counter


def aws(*args):
    return json.loads(subprocess.check_output(['aws', *args, '--output', 'json'], stderr=subprocess.PIPE) or b'{}')


def evidence(row, history):
    if 'meteredLegsDeferredSince' in row:
        return None
    failed_at = row.get('crawlFailedAt', {}).get('S')
    saved_at = row.get('savedAt', {}).get('S')
    if not failed_at or not saved_at or saved_at < history['coverageStart'] or failed_at > history['coverageEnd']:
        return None
    admissions = []
    for event in history['admissions']:
        if event.get('url') != row['url']['S']:
            continue
        pending = event.get('crawlPending', {})
        if pending.get('kind') != 'marked' or event.get('timestamp', '') > failed_at:
            continue
        admissions.append(event)
    if not admissions:
        return None
    latest = max(admissions, key=lambda event: event['timestamp'])
    return latest['timestamp'] if latest.get('meteredLegs') == 'run' else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--table', required=True)
    parser.add_argument('--logs', required=True, help='Local JSON array of normalized retained admission logs: url (article key), timestamp (ISO UTC), meteredLegs, crawlPending')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    with open(args.logs) as source:
        logs = json.load(source)
    counts = Counter()
    rows = aws('dynamodb', 'scan', '--table-name', args.table)['Items']
    for row in rows:
        if 'fullCrawlRequestedAt' in row:
            counts['already-tracked'] += 1
            continue
        if 'meteredLegsDeferredSince' in row:
            counts['deferred'] += 1
            continue
        stamp = evidence(row, logs)
        if stamp is None:
            counts['unverifiable'] += 1
            continue
        counts['eligible'] += 1
        if not args.apply:
            continue
        names = {f'#f{i}': key for i, key in enumerate(row)}
        values = {f':v{i}': value for i, value in enumerate(row.values())}
        values[':stamp'] = {'S': stamp}
        condition = ' AND '.join(f'#f{i} = :v{i}' for i in range(len(row)))
        condition += ' AND attribute_not_exists(fullCrawlRequestedAt) AND attribute_not_exists(meteredLegsDeferredSince)'
        try:
            aws('dynamodb', 'update-item', '--table-name', args.table,
                '--key', json.dumps({'url': row['url']}),
                '--update-expression', 'SET fullCrawlRequestedAt = :stamp',
                '--condition-expression', condition,
                '--expression-attribute-names', json.dumps(names),
                '--expression-attribute-values', json.dumps(values))
            counts['updated'] += 1
        except subprocess.CalledProcessError as error:
            if b'ConditionalCheckFailedException' not in (error.stderr or b''):
                raise
            counts['concurrently-changed'] += 1
    print(json.dumps(counts, sort_keys=True))


if __name__ == '__main__':
    main()
