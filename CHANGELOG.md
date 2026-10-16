# Changelog

All notable changes to this specification are listed here.

## 1.0.0

First public release. Describes four operations of the public ZipViz Registry API at
`https://api.zipviz.ai`:

- `GET /v1/health`: registry health.
- `GET /v1/agent/{domain}`: agent lookup.
- `GET /v1/agent/{domain}/card`: the agent card.
- `POST /v1/verify`: signature verification, with the required request fields, the signing
  payload, the 5-minute freshness window, and distinct verified and mismatch results.
