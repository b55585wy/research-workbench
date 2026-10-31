"""Fetch the pinned PDF.js library, check integrity, and prepare a synthetic PDF."""
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
from urllib.request import urlopen

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

ROOT = Path(__file__).resolve().parents[1]
VERSION = '6.4.299'
INTEGRITY = 'AVl138zALtfaAPvADulE0PZThbYzCBS79nL4pOSL/6Sm/4AH5A21BD9VHt97OlCuzJuCpmeZtAtkinisF4Vb1g=='


def prepare_pdfjs():
    url = f'https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-{VERSION}.tgz'
    with urlopen(url, timeout=60) as response:
        archive = response.read(30 * 1024 * 1024 + 1)
    digest = base64.b64encode(hashlib.sha512(archive).digest()).decode()
    if digest != INTEGRITY:
        raise ValueError('PDF.js archive failed its pinned integrity check')
    target = ROOT / 'frontend/vendor/pdfjs'
    allowed = ('package/build/pdf.mjs', 'package/build/pdf.worker.mjs',
               'package/cmaps/', 'package/standard_fonts/', 'package/wasm/',
               'package/LICENSE', 'package/package.json')
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as source:
        for member in source.getmembers():
            if member.isfile() and any(member.name == p or p.endswith('/') and member.name.startswith(p) for p in allowed):
                relative = PurePosixPath(member.name).relative_to('package')
                if relative.is_absolute() or '..' in relative.parts:
                    raise ValueError('Unexpected archive member')
                output = target.joinpath(*relative.parts)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(source.extractfile(member).read())
    (target / 'upstream.json').write_text(json.dumps({
        'package': 'pdfjs-dist', 'version': VERSION,
        'source': url, 'integrity': 'sha512-' + INTEGRITY,
        'license': 'Apache-2.0',
    }, indent=2), encoding='utf-8')


def prepare_sample():
    writer = PdfWriter()
    for number in (1, 2):
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'),
                                 NameObject('/Subtype'): NameObject('/Type1'),
                                 NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({
            NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        text = [
            (22, 54, 730, 'Synthetic reading example'),
            (12, 54, 700, f'Page {number} - software testing material, not research evidence'),
            (16, 54, 590, 'Read, take a note, return to the source'),
            (12, 54, 560, '1. Select a region or use the whole page as your source.'),
            (12, 54, 535, '2. Write a note and save it.'),
            (12, 54, 510, '3. Reopen the note to find this exact place again.'),
            (12, 54, 350, 'This file contains no patient information or scientific results.'),
        ]
        commands = [f'BT /F1 {size} Tf {x} {y} Td ({value}) Tj ET' for size, x, y, value in text]
        stream = DecodedStreamObject()
        stream.set_data(('\n'.join(commands) + '\n').encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
    writer.add_metadata({'/Title': 'Synthetic reading example'})
    output = ROOT / 'frontend/assets/sample.pdf'
    output.parent.mkdir(parents=True, exist_ok=True)
    writer.write(output)


if __name__ == '__main__':
    prepare_pdfjs()
    prepare_sample()
    print(json.dumps({'pdfjs': VERSION, 'sample': 'synthetic, 2 pages'}))
