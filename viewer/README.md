# Ash NeuroLab — standalone FlyWire fruit-fly brain viewer

This is the independently deployable website for the 3D FlyWire 783 connectome explorer. The portfolio can link to or embed this app; the portfolio no longer needs to build this brain dataset once integration is switched over.

## Data and architecture

- This is a **static dataset**, not a running database server. The browser fetches a manifest, compressed neuron metadata, a bounded overview graph, and selected-neuron outgoing shards.
- Model and annotation inputs are pinned by revision and SHA-256 in `scripts/source-lock.json`.
- `npm run build` copies pinned Three.js modules and builds the dataset into `data/`; the export verifier checks hashes, neuron coverage, shard counts and partner counts.
- Generated data and vendor files are build outputs and must not be committed.
- Research attributions and the model license are included in this repository.

## Local build

Requirements: Node.js 22+, Python 3.12+, and network access for pinned research inputs.

```sh
npm ci
python -m pip install -r scripts/requirements.txt
npm run build
python -m http.server 8080
```

Open http://localhost:8080/. Use an HTTP server; browser module imports and dataset fetches do not work reliably from `file://`.

## Deployment

Create a separate Render Static Site connected to this repository. Set root directory to `viewer`, build command to `python -m pip install -r scripts/requirements.txt && npm ci && npm run build`, and publish directory to `.`. This avoids changing the existing portfolio's Render service configuration.

The generated `data/` folder is produced during each build. No user accounts or server-side database are required. The app loads a neuron's full outgoing connection shard only when a user selects a neuron.

## Portfolio integration

Keep the current portfolio copy until the new site has a successful deployment and has been tested. Then update the portfolio project card to open this site's verified URL or embed it, with a full-screen/open-in-new-tab option.

## Scientific scope and attribution

This project displays measured structural connectivity and recorded anatomical positions. Straight lines represent edges, not reconstructed axon/dendrite morphology. It does not simulate brain activity, thought, learning or consciousness.

- Brain model: Philip Shiu, Nico Spiller and collaborators, [Nature (2024)](https://www.nature.com/articles/s41586-024-07763-9).
- Connectivity: FlyWire Consortium / Dorkenwald et al., [Nature (2024)](https://doi.org/10.1038/s41586-024-07558-y).
- Anatomical annotations: [FlyWire annotations](https://github.com/flyconnectome/flywire_annotations).
- See `MODEL-LICENSE.txt` for the included model license.
