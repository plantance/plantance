# plantance

Describe an app in plain English → get a **live app you own** on your own
Cloudflare account. plantance is the *outer loop* around a coding agent: verify
the build, provision the database, deploy into the user's own account, verify it
went live, and recover gracefully when it doesn't.

**Status: M0 + M1.** Skeleton + the deploy pipeline (no agent yet). The agent
engine (Goose), the golden pack, and the full one-sentence→URL flow are M2–M4.

## Run it

```bash
npm install
npm start        # opens http://localhost:4600
```

- **Setup screen:** paste an Anthropic key, connect Cloudflare.
- **Build it:** runs the M1 pipeline against the hand-written fixture in
  `fixtures/hello-static/` (a Vite+React app + Cloudflare Pages Functions + D1).

## M1 deploy — what's built vs. deferred

Built and typechecked: `CloudflareDeployer` (provision D1, patch `wrangler.toml`,
apply migrations, `pages deploy`, parse the live URL), `Verifier`
(`verifyLocal` build+smoke, `verifyLive` fetch+assert), the state machine wiring
`PLAN→VERIFY_LOCAL→PROVISION→DEPLOY→VERIFY_LIVE→DONE`, `FAIL_SOFT` plain-language
messaging, and the `wrangler login` UX.

**Deferred (needs a Cloudflare account):** the real `d1 create` + `pages deploy`
producing a live `*.pages.dev` URL. Until that runs against a real account, the
M1 kill checkpoint is **not** truly cleared.

To close it once you have a free Cloudflare account: run `npm start`, click
**Connect Cloudflare**, then **Build it**, and confirm a live URL with a
persisted D1 row.

## Layout

- `src/orchestrator/` — the outer-loop state machine + budget caps.
- `src/deploy/` — `Deployer` interface + `CloudflareDeployer`.
- `src/verify/` — local build/smoke + live checks.
- `src/engine/` — `AgentEngine` interface (Goose adapter lands in M2).
- `src/packs/` — pack loader + schema (the extension mechanism).
- `fixtures/hello-static/` — the known-good app shape the agent is later
  constrained to.

## License

Source-available under **FSL-1.1-MIT** (converts to MIT after 2 years). Not an
OSI "open source" license. See `LICENSE` (placeholder — finalize before release).
