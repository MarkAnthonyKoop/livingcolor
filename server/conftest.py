"""Shared fixtures for the server test suite."""
import pytest

from server import core
from server import app as appmod


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Production-like client: exceptions become 500 responses rather than
    re-raising, so a test asserting `status_code == 400` genuinely fails when
    validation is missing (TESTING=True would mask that as an exception)."""
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)
    appmod.app.config['TESTING'] = False
    appmod.app.config['PROPAGATE_EXCEPTIONS'] = False
    with appmod.app.test_client() as c:
        yield c
