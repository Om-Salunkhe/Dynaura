# AI usage: dy-arc (Arc contracts and Arc Studio)

An AI coding session (Claude Code) helped with the Arc side. Everything it produced was reviewed and committed by the team.

| When (IST) | What the AI did | Human part |
|---|---|---|
| Fri 01:00 | Researched Arc Studio from the official sources (studio.arc.io, its llms.txt, the `@circle-fin/arc-studio-cli` package, docs.arc.io) and the Arc testnet facts (checked against the live RPC). Wrote `contracts/STUDIO.md`. | Pawan signs in to Studio, authorizes the CLI and uses the faucet |
| Fri 01:00 | Drafted the Arc Studio prompts in `contracts/studio/` that describe our three contracts, so Studio generates, tests and deploys them | Team reviews the spec |
