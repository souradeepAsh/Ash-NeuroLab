"""Check the complete shipped graph, hashes, precision and anatomical coverage."""
import gzip, hashlib, json
from pathlib import Path
import numpy as np
p = Path(__file__).resolve().parents[1] / 'data'
m = json.loads((p/'manifest.json').read_text())
n = json.loads(gzip.decompress((p/'neurons.json.gz').read_bytes()))
assert len(n) == m['renderedNeurons']
assert len({r[0] for r in n}) == len(n)
assert all(isinstance(r[0], str) and r[0].isdigit() for r in n)
assert np.isfinite(np.array([r[1:4] for r in n])).all()
assert len(n) + len(m['unmappedNeuronIds']) == m['modelNeurons']
for filename, info in m['files'].items():
    raw = (p/filename).read_bytes()
    assert len(raw) == info['bytes'], filename
    assert len(gzip.decompress(raw)) == info['rawBytes'], filename
    assert hashlib.sha256(raw).hexdigest() == info['sha256'], filename
incoming = np.zeros(len(n), dtype=np.int64)
outgoing = np.zeros(len(n), dtype=np.int64)
total = 0
for i, shard in enumerate(m['shards']):
    a = np.frombuffer(gzip.decompress((p/shard['file']).read_bytes()), dtype='<u4').reshape(-1,3)
    assert len(a) == shard['edges']
    assert (a[:,0] // m['shardSize'] == i).all()
    assert (a[:,:2] < len(n)).all() and (a[:,2] > 0).all()
    outgoing += np.bincount(a[:,0], minlength=len(n))
    incoming += np.bincount(a[:,1], minlength=len(n))
    total += len(a)
assert total == m['mappedEdges']
assert total + m['unmappedEdges'] == m['sourceEdges']
assert np.array_equal(incoming, [r[9] for r in n])
assert np.array_equal(outgoing, [r[10] for r in n])
o = np.frombuffer(gzip.decompress((p/'overview.bin.gz').read_bytes()),dtype='<u4').reshape(-1,3)
assert len(o) == m['overviewEdges'] and (o[:-1,2] >= o[1:,2]).all()
print(f'PASS: {len(n):,} real neuron positions, {total:,} mapped directed connections, all hashes and partner counts verified.')
