# Changelog

All notable changes to this specification are listed here.

## Unreleased

- Add `POST /v1/agent/{domain}/address`: an agent sets its public card URL with its own key, proven by a GET endpoint proof from that URL (`/.well-known/zipviz/endpoint-proof`, RFC 8785 canonical body). Copied from the registry's own `/openapi.json`. A registry with the update switched off answers 503 `E_ADDRESS_DISABLED`.
- Add v1 signature test vectors (`test-vectors/verify-v1.json`) and an offline checker (`test-vectors/check.mjs`) with a CI job.
- Add a proposed payment plug design (`docs/payment-plug.md`): a signed v=5 payment envelope and a provider adapter interface, with x402 as the reference adapter. Proposed only; the API is unchanged.

## 1.0.0

First public release. Describes four operations of the public ZipViz Registry API at
`https://api.zipviz.ai`:

- `GET /v1/health`: registry health.
- `GET /v1/agent/{domain}`: agent lookup.
- `GET /v1/agent/{domain}/card`: the agent card.
- `POST /v1/verify`: signature verification, with the required request fields, the signing
  payload, the 5-minute freshness window, and distinct verified and mismatch results.
