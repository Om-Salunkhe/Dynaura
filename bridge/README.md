# bridge

Small Node 22 service that writes Dynaura records to **Arkiv** (Rabdi testnet) with `@arkiv-network/sdk`.
The Pi's Python code posts JSON to it on `127.0.0.1:5100`; nothing else can reach it.

```
cd bridge
npm install
npm start          # reads ../.env
curl http://127.0.0.1:5100/health
```

Needs in the root `.env`:

- `ARKIV_PRIVATE_KEY`: the building wallet (owns every record). Fund it with tGLM at https://hub.arkiv.network/faucet
- `ARKIV_ACCESS_KEY`: free key from https://hub.arkiv.network/access-keys (the public endpoint is rate limited)
