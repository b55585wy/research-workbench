"""Fixed raw-cell equality projection; no user code or expressions."""
import base64
import csv
import hashlib
import io
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tabular import MAX_BYTES, numeric, parse


def project(path, delimiter, request):
    profile, rows = parse(path, delimiter)
    headers = [c['name'] for c in profile['columns']]
    if request['column'] not in headers: raise ValueError('unknown_column')
    index = headers.index(request['column'])
    if request['mode'] == 'values':
        counts = {}
        for row in rows: counts[row[index]] = counts.get(row[index], 0) + 1
        matches = [(v, n) for v, n in counts.items() if request['query'] in v]
        offset, limit = request['offset'], request['limit']
        return {'items': [{'value': v, 'count': n} for v, n in matches[offset:offset+limit]],
                'total_distinct': len(counts), 'total_matches': len(matches), 'offset': offset,
                'limit': limit, 'has_more': offset+limit < len(matches)}
    mapping = [i+1 for i, row in enumerate(rows) if row[index] == request['value']]
    selected = [rows[i-1] for i in mapping]
    output = io.StringIO(newline='')
    writer = csv.writer(output, lineterminator='\n')
    writer.writerow(headers); writer.writerows(selected)
    data = output.getvalue().encode('utf-8')
    if len(data) > MAX_BYTES: raise ValueError('dataset_too_large')
    columns = []
    for i, name in enumerate(headers):
        present = [row[i] for row in selected if row[i].strip()]
        numbers = [numeric(v) for v in present]
        columns.append({'name': name, 'numeric': bool(present) and all(v is not None for v in numbers),
                        'nonempty': len(present), 'missing': len(selected)-len(present)})
    child = {'row_count': len(selected), 'column_count': len(headers), 'columns': columns,
             'preview': [[c[:200] for c in row] for row in selected[:5]],
             'sample_truncated': len(selected) > 5 or any(len(c) > 200 for row in selected[:5] for c in row)}
    return {'profile': child, 'source_rows': mapping, 'data': base64.b64encode(data).decode('ascii'),
            'source_row_count': len(rows), 'result_sha256': hashlib.sha256(data).hexdigest()}


if __name__ == '__main__':
    try:
        value = project(sys.argv[1], sys.argv[2], json.load(sys.stdin))
        print(json.dumps(value, ensure_ascii=True, allow_nan=False))
    except (ValueError, UnicodeError, csv.Error, KeyError) as error:
        print(json.dumps({'error': str(error)[:80]})); sys.exit(2)
