import io

from fastapi.testclient import TestClient
from pypdf import PdfWriter
import pytest

from research_workbench.main import create_app


def make_pdf(pages=2, encrypted=False):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    if encrypted:
        writer.encrypt('synthetic-test-password')
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def pdf():
    return make_pdf()


@pytest.fixture
def app(tmp_path):
    return create_app(tmp_path / 'workspace')


@pytest.fixture
def client(app):
    with TestClient(app, base_url='http://127.0.0.1', client=('127.0.0.1', 48000)) as client:
        yield client


@pytest.fixture
def document(client, pdf):
    response = client.post('/api/v1/documents', files={'file': ('synthetic.pdf', pdf, 'application/pdf')})
    assert response.status_code == 201, response.text
    return response.json()
