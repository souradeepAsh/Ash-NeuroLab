"""Build browser data from public, commit-pinned, checksum-verified inputs."""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

scripts = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'ash-neurolab-sources')
a = parser.parse_args()
lock = json.loads((scripts / 'source-lock.json').read_text())
a.cache.mkdir(parents=True, exist_ok=True)

def digest(path):
    with path.open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()

for source in lock['sources']:
    target = a.cache / source['name']
    if target.exists() and digest(target) == source['sha256']:
        continue
    part = target.with_suffix(target.suffix + '.partial')
    print('Downloading pinned research input:', source['name'], flush=True)
    request = urllib.request.Request(source['url'], headers={'User-Agent': 'Ash-NeuroLab-dataset-builder/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, part.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if digest(part) != source['sha256']:
            raise RuntimeError(f"Input checksum mismatch: {source['name']}")
        os.replace(part, target)
    finally:
        part.unlink(missing_ok=True)

subprocess.run([sys.executable, str(scripts / 'export_connectome.py'), '--model', str(a.cache),
                '--annotations', str(a.cache / 'annotations.tsv'),
                '--annotation-revision', lock['annotationRevision'],
                '--output', str(scripts.parent / 'data')], check=True)
subprocess.run([sys.executable, str(scripts / 'verify_export.py')], check=True)
