"""Build a pinned previous release without altering its Git tag or world data.

Python 3.9+, standard library only. Run from any directory:
python tools/make-rollback.py v0.17.0 --previous-zip previous.zip \
  --expected-sha256 SHA256 --out-dir /path/to/release-assets
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('previous_tag')
parser.add_argument('--previous-zip', type=Path, required=True)
parser.add_argument('--expected-sha256', required=True)
parser.add_argument('--out-dir', type=Path, required=True)
args = parser.parse_args()

def git(*arguments):
    return subprocess.check_output(['git', '-C', str(ROOT), *arguments])

current = json.loads((ROOT / 'module.json').read_text(encoding='utf-8'))
release = current['version']
commit = git('rev-parse', '--verify', args.previous_tag + '^{commit}').decode().strip()
source = args.previous_zip.read_bytes()
source_sha256 = hashlib.sha256(source).hexdigest()
assert source_sha256 == args.expected_sha256.lower(), 'Published source ZIP checksum differs'
with zipfile.ZipFile(io.BytesIO(source)) as archive:
    assert archive.testzip() is None
    entries = {name: archive.read(name) for name in archive.namelist() if not name.endswith('/')}
original_entries = entries.copy()
# Match the published files to the old commit, allowing only Windows line endings.
tracked = set(git('ls-tree', '-r', '--name-only', commit).decode().splitlines())
assert set(entries) == tracked, 'Published ZIP and previous tag contain different files'
text_suffixes = {'.md', '.mjs', '.js', '.hbs', '.css', '.json', '.html', '.txt', '.svg', '.py'}
for name, data in entries.items():
    expected = git('show', commit + ':' + name)
    if Path(name).suffix in text_suffixes or name in {'.gitattributes', '.gitignore', 'LICENSE'}:
        data, expected = data.replace(b'\r\n', b'\n'), expected.replace(b'\r\n', b'\n')
    assert data == expected, 'Published ZIP differs from source tag: ' + name
previous = json.loads(entries['module.json'])
version = previous['version']
assert args.previous_tag == 'v' + version, 'Tag and manifest versions differ'
assert previous['id'] == current['id'] == 'night-city-agent'
assert version != release, 'Rollback must target a previous version'
base = current['url'].rstrip('/') + '/releases/download/v' + release
manifest_name = 'rollback-' + version + '.json'
zip_name = 'night-city-agent-rollback-' + version + '.zip'
previous['manifest'] = base + '/' + manifest_name
previous['download'] = base + '/' + zip_name
manifest = (json.dumps(previous, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
entries['module.json'] = manifest

# The new map may already be selected in world settings when reverting.
compatibility_asset = 'assets/night-city-2045.webp'
compatibility_assets = []
if compatibility_asset not in entries:
    entries[compatibility_asset] = (ROOT / compatibility_asset).read_bytes()
    compatibility_assets.append(compatibility_asset)
args.out_dir.mkdir(parents=True, exist_ok=True)
out = args.out_dir / zip_name
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, data in entries.items():
        archive.writestr(name, data)
(args.out_dir / manifest_name).write_bytes(manifest)

with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(entries)
    for name, data in entries.items():
        assert archive.read(name) == data, name
        if name not in {'module.json', compatibility_asset}:
            assert archive.read(name) == original_entries[name], name
    assert archive.read('module.json') == manifest
    for name in previous['esmodules'] + previous['styles'] + [x['path'] for x in previous['languages']]:
        assert name in entries, name
    for pack in previous['packs']:
        head = entries[pack['path'] + '/CURRENT'].decode().strip()
        assert pack['path'] + '/' + head in entries

info = {
    'release': release, 'rollback_version': version, 'source_tag': args.previous_tag,
    'source_commit': commit, 'source_zip_sha256': source_sha256, 'manifest': previous['manifest'], 'download': previous['download'],
    'modified_source_files': ['module.json'], 'compatibility_assets': compatibility_assets,
    'files': len(entries), 'bytes': out.stat().st_size,
    'sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'archive_verified': True,
}
(args.out_dir / 'rollback-info.json').write_text(json.dumps(info, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(info))
