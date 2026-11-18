# ZipViz Registry API: OpenAPI specification

The OpenAPI 3.1 description of the public ZipViz Registry API. The registry binds each `.viz` agent name to an Ed25519 public key, so anyone can look an agent up and check what it signed.

- Base URL: `https://api.zipviz.ai`
- Specification: [`openapi.json`](openapi.json)
- No API key is needed for the endpoints below.

## Endpoints

| Method and path | What it does |
|---|---|
| `GET /v1/health` | Registry health |
| `GET /v1/agent/{domain}` | Look up a registered agent: its key, status and provenance |
| `GET /v1/agent/{domain}/card` | Read the agent's public card |
| `POST /v1/verify` | Check a signature against the agent's registered key |

### Health

```sh
curl https://api.zipviz.ai/v1/health
```

It returns `{"status":"ok"}` with the server's current `timestamp`.

### Look up an agent

```sh
curl https://api.zipviz.ai/v1/agent/zorro-her.smc.viz
```

The response includes the agent's `domain`, its `status` (for example `registered`), its `public_key` (the Ed25519 public key in hex) and `proven_by`, what has been proven for the name. A name that isn't registered returns `404`.

### Read the agent card

```sh
curl https://api.zipviz.ai/v1/agent/zorro-her.smc.viz/card
```

The card carries the agent's name, endpoint URL, public key, supported protocols and authentication schemes. See `openapi.json` for every field.

### Verify a signature

```sh
curl -s https://api.zipviz.ai/v1/verify \
  -H 'Content-Type: application/json' \
  -d '{"from":"<name>.viz","message":"<text>","timestamp":"<ISO-8601>","signature":"<base64>"}'
```

- The signer signs the UTF-8 bytes of `JSON.stringify({v: 1, from, message, timestamp})`, keys in exactly that order, with its registered Ed25519 key, and sends the 64-byte signature base64-encoded.
- `timestamp` must be within 5 minutes of the server clock.
- **A signature is valid only when the response has `"verified": true`.** A mismatch also returns HTTP 200, with `"verified": false` and code `E_SIG_MISMATCH`.

The [CLI](https://github.com/ZipViz/zipviz-cli) and the [MCP server](https://github.com/ZipViz/zipviz-mcp) build and sign this payload for you.

## Signature test vectors

[`test-vectors/verify-v1.json`](test-vectors/verify-v1.json) holds 8 test cases for the v1 signing rule above, so you can check your own signing and verifying code offline. Each case records the request body exactly as it is sent to `POST /v1/verify`, the public key (hex), the verifier's clock (`now`), the signed string (what a verifier rebuilds from the request), and the expected result.

| Case | Expected |
|---|---|
| `valid` | valid |
| `message_tampered` | invalid, `E_SIG_MISMATCH` |
| `from_tampered` | invalid, `E_SIG_MISMATCH` |
| `signature_from_different_key` | invalid, `E_SIG_MISMATCH` |
| `keys_in_wrong_order` (signed over `{v, message, from, timestamp}`) | invalid, `E_SIG_MISMATCH` |
| `timestamp_6_minutes_old` | invalid, `E_STALE` |
| `timestamp_6_minutes_future` | invalid, `E_STALE` |
| `non_ascii_message` (accents, CJK, emoji) | valid |

The reasons are the codes in `openapi.json`. Over the API, a signature mismatch is HTTP 200 with `verified: false`, and a timestamp outside the window is HTTP 400. The vectors take the registered key for `from` as given (`public_key`), so a `from` that is not registered, which the API answers with `E_AGENT_NOT_FOUND`, is not covered. In `from_tampered`, the changed name is assumed to resolve to the same key. A case that carries `signature_made_over` shows the exact string its signature was made over when that differs from the signed string.

Run the check with Node 22 or later (the CI job uses Node 22). It uses only Node built-ins:

```sh
node test-vectors/check.mjs
```

It rebuilds the signed bytes for every case, verifies each signature against the expected result, and checks that the secret key reproduces every signature byte for byte (Ed25519 signatures are deterministic). It exits with a non-zero status on any mismatch.

**The keys are TEST ONLY.** The vectors use the public Ed25519 test keys from RFC 8032 section 7.1: TEST 1 signs and verifies, and TEST 2 makes the signature in `signature_from_different_key`. Their secret keys are published in the RFC and in the vector file. Never register them or use them for anything real. All names are under `example.test.viz`.

## Start here

- [zipviz-cli](https://github.com/ZipViz/zipviz-cli): create a key, claim a name, and verify names and signatures from the command line.
- [zipviz-mcp](https://github.com/ZipViz/zipviz-mcp): use the registry from Claude, Cursor and other MCP clients.
- [zipviz.ai/developers](https://zipviz.ai/developers)

## Contributing

See `CONTRIBUTING.md`. Changes are listed in `CHANGELOG.md`.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.

## Security

See `SECURITY.md`.
