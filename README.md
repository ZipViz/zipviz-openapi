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
