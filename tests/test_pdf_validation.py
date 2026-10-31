from pathlib import Path
import time

import pytest

from research_workbench.models import WorkspaceError
from research_workbench.pdf_validation import PdfValidator
import research_workbench.pdf_validation as validation
from conftest import make_pdf


def test_real_pdf_probe_returns_page_count(tmp_path, pdf):
    path = tmp_path / 'valid.pdf'
    path.write_bytes(pdf)
    assert PdfValidator()(path) == 2


def test_parser_busy_is_rejected_without_waiting(tmp_path):
    validator = PdfValidator()
    validator.slots.acquire()
    try:
        with pytest.raises(WorkspaceError) as error:
            validator(tmp_path / 'not-read.pdf')
        assert error.value.code == 'parser_busy'
    finally:
        validator.slots.release()


def test_maximum_page_count_is_accepted(tmp_path):
    path = tmp_path / 'maximum.pdf'
    path.write_bytes(make_pdf(200))
    assert PdfValidator()(path) == 200


@pytest.mark.parametrize('script,code', [
    ('import time; time.sleep(10)', 'parser_timeout'),
    ('import os; os._exit(37)', 'parser_failed'),
    ('print("not JSON")', 'parser_failed'),
    ('print("{\\"page_count\\":true}")', 'parser_failed'),
])
def test_real_failed_child_is_bounded_and_slot_recovers(tmp_path, pdf, monkeypatch, script, code):
    probe = tmp_path / 'probe.py'
    probe.write_text(script, encoding='utf-8')
    path = tmp_path / 'input.pdf'
    path.write_bytes(pdf)
    original = validation.PROBE
    monkeypatch.setattr(validation, 'PROBE', probe)
    validator = PdfValidator(timeout=0.5)
    started = time.monotonic()
    with pytest.raises(WorkspaceError) as error:
        validator(path)
    assert error.value.code == code
    assert time.monotonic() - started < 3
    monkeypatch.setattr(validation, 'PROBE', original)
    assert validator(path) == 2


def test_web_app_remains_available_after_parser_failure(client, app, pdf, monkeypatch, tmp_path):
    probe = tmp_path / 'crash.py'
    probe.write_text('import os; os._exit(37)', encoding='utf-8')
    monkeypatch.setattr(validation, 'PROBE', probe)
    response = client.post('/api/v1/documents', files={'file': ('input.pdf', pdf)})
    assert response.status_code == 422
    assert client.get('/api/v1/health').json()['status'] == 'ok'
    assert client.get('/api/v1/documents').json()['items'] == []
