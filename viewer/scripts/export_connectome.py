"""Export a version-matched FlyWire 783 anatomical graph for Three.js.

Usage: python export_connectome.py --model /path/to/Ash-NeuroLab --annotations annotations.tsv --annotation-revision SHA
Requires numpy, pandas, pyarrow. Does not invent positions or neuron morphology.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd

p = argparse.ArgumentParser()
p.add_argument('--model', type=Path, required=True)
p.add_argument('--annotations', type=Path, required=True)
p.add_argument('--annotation-revision', required=True)
p.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'Frontend/data')
a = p.parse_args()
a.output.mkdir(parents=True, exist_ok=True)

def gz(name, value):
    raw = value if isinstance(value, bytes) else json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
    compressed = gzip.compress(raw, compresslevel=6, mtime=0)
    (a.output / name).write_bytes(compressed)
    return {'bytes': len(compressed), 'rawBytes': len(raw), 'sha256': hashlib.sha256(compressed).hexdigest()}

ids = pd.read_csv(a.model / 'Completeness_783.csv', dtype=str).iloc[:, 0].tolist()
annotations = pd.read_csv(a.annotations, sep='\t', dtype={'root_id': str}, low_memory=False).set_index('root_id')
assert not annotations.index.duplicated().any()
missing = [i for i in ids if i not in annotations.index]
ordered = [i for i in ids if i in annotations.index]
ann = annotations.loc[ordered]
soma = ann[['soma_x', 'soma_y', 'soma_z']].notna().all(axis=1).to_numpy()
coords = ann[['pos_x', 'pos_y', 'pos_z']].to_numpy(float)
coords[soma] = ann.loc[soma, ['soma_x', 'soma_y', 'soma_z']].to_numpy(float)
coords *= np.array([0.004, 0.004, 0.04])  # 4 x 4 x 40 nm voxel coordinates -> micrometres
assert np.isfinite(coords).all()
center = (coords.max(axis=0) + coords.min(axis=0)) / 2
coords -= center
classes = sorted(ann.super_class.fillna('unknown').unique().tolist())
nts = sorted(ann.top_nt.fillna('unknown').unique().tolist())
edges = pd.read_parquet(a.model / 'Connectivity_783.parquet', columns=['Presynaptic_ID', 'Postsynaptic_ID', 'Connectivity'])
index = pd.Series(np.arange(len(ordered)), index=pd.Index(ordered).astype('int64'))
src = edges.Presynaptic_ID.map(index)
dst = edges.Postsynaptic_ID.map(index)
valid = src.notna() & dst.notna()
graph = np.column_stack([src[valid].to_numpy(np.uint32), dst[valid].to_numpy(np.uint32), edges.loc[valid, 'Connectivity'].to_numpy(np.uint32)]).astype('<u4')
assert (graph[:, 2] > 0).all()
out_count = np.bincount(graph[:,0], minlength=len(ordered))
in_count = np.bincount(graph[:,1], minlength=len(ordered))
rows = []
for n, (root, row) in enumerate(ann.iterrows()):
    rows.append([root, *np.round(coords[n], 3).tolist(), classes.index(row.super_class if pd.notna(row.super_class) else 'unknown'), str(row.cell_type) if pd.notna(row.cell_type) else '', nts.index(row.top_nt if pd.notna(row.top_nt) else 'unknown'), str(row.side) if pd.notna(row.side) else 'unknown', int(soma[n]), int(in_count[n]), int(out_count[n])])
files = {'neurons.json.gz': gz('neurons.json.gz', rows)}
order = np.argsort(-graph[:,2].astype('int64'), kind='stable')[:150000]
files['overview.bin.gz'] = gz('overview.bin.gz', graph[order].tobytes())
shard_size = 2048
shards = []
for start in range(0, len(ordered), shard_size):
    name = f'outgoing-{start // shard_size:03}.bin.gz'
    subset = graph[(graph[:,0] >= start) & (graph[:,0] < start + shard_size)]
    files[name] = gz(name, subset.tobytes())
    shards.append({'file': name, 'edges': len(subset), **files[name]})
manifest = {
    'version': 1, 'release': 'FlyWire 783', 'modelNeurons': len(ids), 'renderedNeurons': len(ordered),
    'unmappedNeuronIds': missing, 'sourceEdges': len(edges), 'mappedEdges': len(graph),
    'unmappedEdges': int((~valid).sum()), 'sourceSynapseWeightSum': int(edges.Connectivity.sum()),
    'somaPositions': int(soma.sum()), 'anchorPositions': int((~soma).sum()),
    'coordinateUnit': 'micrometre', 'voxelSizeNm': [4,4,40], 'centerUm': center.tolist(),
    'classes': classes, 'neurotransmitters': nts, 'shardSize': shard_size, 'shards': shards,
    'overviewEdges': len(order), 'overviewMinimumWeight': int(graph[order[-1],2]),
    'fields': ['root_id','x','y','z','class','cell_type','predicted_nt','side','is_soma','incoming_partners','outgoing_partners'],
    'modelRepository': 'https://github.com/souradeepAsh/Ash-NeuroLab',
    'modelRevision': '91bdd1e7dcf193f3e7ca5a8933497fcef63b7960',
    'annotationRevision': a.annotation_revision,
    'annotationSource': f'https://github.com/flyconnectome/flywire_annotations/blob/{a.annotation_revision}/supplemental_files/Supplemental_file1_neuron_annotations.tsv',
    'sourceHashes': {f: hashlib.sha256((a.model/f).read_bytes()).hexdigest() for f in ['Completeness_783.csv', 'Connectivity_783.parquet']},
    'annotationSha256': hashlib.sha256(a.annotations.read_bytes()).hexdigest(), 'files': files,
    'representation': 'One point per mapped neuron at its soma, or recorded anchor if soma unavailable. Straight edges encode connectivity, not axon paths. No neural activity simulation.'
}
(a.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(json.dumps({k:manifest[k] for k in ['modelNeurons','renderedNeurons','sourceEdges','mappedEdges','somaPositions','anchorPositions','overviewMinimumWeight']}))
print('Compressed bytes:',sum(v['bytes'] for v in files.values()))
