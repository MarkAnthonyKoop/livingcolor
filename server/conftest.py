"""Shared fixtures for the server test suite."""
import pytest

from server import core
from server import app as appmod


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(core, 'archive_dir', lambda: tmp_path)
    appmod.app.config['TESTING'] = True
    with appmod.app.test_client() as c:
        yield c
