"""Build-time installation of the exact tested upstream archive."""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request
import zipfile

VERSION = '152.0.4-beta.30'
DIGEST = '5720d45b894ce1770543de024c6f10d514b38be560fa2dc3226b3d8586caf672'
DESTINATION = Path('/opt/camoufox')
URL = f'https://github.com/daijro/camoufox/releases/download/v{VERSION}/camoufox-{VERSION}-lin.x86_64.zip'
with tempfile.TemporaryFile() as archive:
    digest = hashlib.sha256()
    with urllib.request.urlopen(URL, timeout=120) as response:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            archive.write(chunk)
    if digest.hexdigest() != DIGEST:
        raise RuntimeError('Browser archive checksum mismatch')
    archive.seek(0)
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as contents:
        for member in contents.infolist():
            target = (DESTINATION / member.filename).resolve()
            if not target.is_relative_to(DESTINATION):
                raise RuntimeError('Invalid archive path')
        contents.extractall(DESTINATION)
        for member in contents.infolist():
            mode = member.external_attr >> 16
            if mode & 0o111:
                os.chmod(DESTINATION / member.filename, 0o755)
(DESTINATION / 'version.json').write_text(json.dumps({'version': '152.0.4', 'release': 'beta.30'}))
if not (DESTINATION / 'camoufox').is_file():
    raise RuntimeError('Browser binary missing')
