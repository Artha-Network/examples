# examples
Tiny runnable end-to-end samples (Postman collection, notebooks) that stitch published packages and public endpoints.


---
```md
# Examples (E2E & Notebooks)

Tiny, runnable examples demonstrating how to stitch the SDKs and services.

## Contents
- `actions-e2e.http` — VSCode REST client examples for /actions/*
- `postman_collection.json` — same endpoints as Postman
- `notebooks/fund_release.ipynb` — step-by-step initiate → fund → release

## Running
1) Ensure `actions-server` is up and points to your local/dev RPC.
2) Open `actions-e2e.http` and click **Send Request** on each step.
3) Watch logs in `onchain-escrow` tests / validators.

## Tips
- Use small amounts on devnet.
- Validate txs with the explorer using the returned signatures.

## License
MIT
