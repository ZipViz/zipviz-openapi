# Changelog

All notable changes to this specification are listed here.

## Unreleased

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
