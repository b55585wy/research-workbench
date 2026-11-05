import json

from research_workbench.shared_model import SharedFallbackModelConnection


def test_owner_explicit_external_connection_still_works(tmp_path):
    root = tmp_path / 'owner'
    root.mkdir()
    external = tmp_path / 'owner-provider.json'
    external.write_text(json.dumps({'base_url': 'https://owner.example/v1', 'model': 'owner-model', 'api_key': 'synthetic-owner-key'}))
    provider = SharedFallbackModelConnection.from_paths(root, external, guest_policy=False)
    config, source = provider.config()
    assert source == 'inherited'
    assert config['model'] == 'owner-model'
    assert provider.status()['configured'] is True


def test_owner_local_connection_keeps_priority(tmp_path):
    root = tmp_path / 'owner'
    root.mkdir()
    external = tmp_path / 'owner-provider.json'
    external.write_text(json.dumps({'base_url': 'https://owner.example/v1', 'model': 'external-model', 'api_key': 'synthetic-external-key'}))
    (root / '.agent-model.json').write_text(json.dumps({'base_url': 'https://owner.example/v1', 'model': 'local-model', 'api_key': 'synthetic-local-key'}))
    config, source = SharedFallbackModelConnection.from_paths(root, external, guest_policy=False).config()
    assert source == 'local'
    assert config['model'] == 'local-model'
