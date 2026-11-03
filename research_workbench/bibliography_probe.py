"""Fixed bounded PDF metadata/identifier operation, executed as a child process."""
import json
import re
import sys
from pypdf import PdfReader


if __name__ == '__main__':
    try:
        reader = PdfReader(sys.argv[1])
        if reader.is_encrypted or not 1 <= len(reader.pages) <= 200:
            raise ValueError('Unsupported document')
        metadata = reader.metadata or {}
        fields = {}
        for source, target in (('/Title', 'title'), ('/Author', 'authors')):
            value = metadata.get(source)
            if isinstance(value, str) and value.strip():
                fields[target] = value.strip()[:4096]
        candidates = []
        for page in reader.pages[:3]:
            text = (page.extract_text() or '')[:12000]
            for match in re.findall(r'10\.\d{4,9}/[^\s<>"\]]{1,240}', text, re.IGNORECASE):
                value = match.rstrip('.,;:。')
                while value.endswith(')') and value.count(')') > value.count('('):
                    value = value[:-1]
                if value.lower() not in candidates:
                    candidates.append(value.lower())
        print(json.dumps({'fields': fields, 'candidates': candidates[:10], 'pages_inspected': list(range(1, min(3, len(reader.pages)) + 1))}, ensure_ascii=True))
    except Exception:
        print(json.dumps({'error': 'bibliography_probe_failed'}))
        raise SystemExit(1)
