# Payment plug: bring your own provider

**Status: Proposed. Not implemented.** Nothing here changes the live API or `openapi.json`. This
document proposes a signed payment envelope (v=4) and a provider adapter interface, for review
before any code is written.

## What this is

ZipViz proves who an agent is. A payment provider moves the money. The payment plug lets any
provider sit next to ZipViz identity without ZipViz touching the payment:

- The payer agent signs a short **payment envelope** with its registered `.viz` key. The envelope
  states who is paying, whom, how much, for what, and which provider payment it belongs to.
- The payee checks that envelope against the registry, then lets **its own provider** verify and
  settle the payment.
- A **provider adapter** wraps each provider behind the same four calls: `requirements()`,
  `pay()`, `verify()` and `settle()`.

ZipViz never holds funds, wallets or payment keys, and is never in the money path. The registry is
used only to look up the payer's public key, exactly as for any other signature. No payment data
is sent to ZipViz.

x402 is the reference adapter. Other providers map onto the same interface (see
[Other providers](#other-providers)).

## Roles and flow

| Role | Who | Holds |
|---|---|---|
| Payer | An agent with a registered `.viz` name | Its Ed25519 `.viz` key, and its own wallet or provider account |
| Payee | The service that is paid | Its provider account, and optionally its own `.viz` name |
| Provider | x402 facilitator, or another payment provider | Everything about moving money |

1. The payer asks for a resource. The payee answers with its payment terms (`requirements()`).
2. The payer makes the provider payment credential (`pay()`), then signs a v=4 envelope over the
   terms and a hash of that credential. It sends both.
3. The payee checks the envelope (see [Verifying a v=4 envelope](#verifying-a-v4-envelope)). This
   is local and costs no money.
4. The payee asks the provider to verify and settle the credential (`verify()`, `settle()`), in
   the order the provider requires.
5. Optionally, the payee returns a signed receipt record (a v=4 envelope signed by the payee).

## Envelope versions

Every ZipViz envelope carries its version `v` as the first key **inside the signed bytes**.

| `v` | Used for | Defined in |
|---|---|---|
| 1 | Signed message checked by `POST /v1/verify` | `openapi.json` |
| 2 | Direct message between agents (`to`, `msg_id`, `expires_at`, optional `reply_to`) | zipviz-mcp `src/core/envelope.ts` |
| 3 | v=2 plus `conversation` | zipviz-mcp `src/core/envelope.ts` |
| 4 | **Proposed:** payment envelope | This document |

Rules for every version:

- The meaning of a published version never changes. v=4 changes nothing about v=1, v=2 or v=3.
  Payment is a separate, payer-signed v=4 envelope, not a new block inside v=2 or v=3: a block
  added there would change what those signed envelopes mean, and verifiers built before it would
  skip it without saying so. A v=4 envelope can point at a direct message with `msg_id`.
- A verifier checks only the versions it implements. It **rejects** an envelope with any other
  `v`. It never strips unknown fields and verifies the rest as an older version.
- Because `v` is signed, a v=4 signature can't verify as v=1, v=2 or v=3, and the reverse. A
  verifier that only knows v=1 (for example today's `POST /v1/verify`) answers a v=4 envelope with
  `verified: false`. It fails closed.

## Envelope v=4

### Signed string

The signer signs the UTF-8 bytes of:

```js
JSON.stringify({
  v: 4,
  from,       // the signer's .viz name
  message,    // app text, may be ""
  timestamp,  // ISO-8601
  msg_id,     // optional: the v=2 or v=3 direct message this payment belongs to
  payment: {
    provider, payer, payee, amount, asset,
    network,      // omitted when the provider has none
    resource,     // omitted when there is no resource URL
    ref,
    receipt_id,   // receipt records only
    receipt_sig,  // receipt records only
  },
})
```

Keys go in exactly this order. An optional key that has no value (`msg_id`, and the optional
`payment` keys) is **left out**, never sent as `null` or `""`. Every `payment` value is a string. The signature is Ed25519 with the `.viz` key,
64 bytes, sent base64-encoded, the same as v=1.

### Fields

| Field | Required | Rule |
|---|---|---|
| `v` | yes | The number `4` |
| `from` | yes | The signer's registered `.viz` name |
| `message` | yes | App text, may be empty. Never put personal data or payment credentials here. |
| `timestamp` | yes | ISO-8601, within ±5 minutes of the verifier's clock |
| `msg_id` | no | The `msg_id` of the v=2 or v=3 direct message this payment belongs to, same shape (`^[A-Za-z0-9_-]{8,128}$`). It points at that message; it does not change what the message's own signature means. |
| `payment.provider` | yes | Provider id, `^[a-z0-9][a-z0-9-]{0,31}$`. This document defines `x402`, `skyfire` and `stripe-acp`. |
| `payment.payer` | yes | The payer's `.viz` name. In a payer envelope it equals `from`. |
| `payment.payee` | yes | The payee's id at the provider (x402: `payTo`), at most 256 characters |
| `payment.amount` | yes | Base-10 integer, no sign, no leading zeros, in the asset's smallest unit (x402 `amount`; minor units for fiat). For providers that charge up to a ceiling, this is the most the payer agrees to pay. |
| `payment.asset` | yes | Token contract address, or ISO 4217 code for fiat |
| `payment.network` | when the provider has one | CAIP-2 chain id (for example `eip155:8453`) |
| `payment.resource` | when the payment is for a URL | Absolute `https` URL of the resource, at most 2048 characters |
| `payment.ref` | yes | base64url (no padding) of SHA-256 over the exact provider credential as sent (see each adapter). Binds the envelope to one payment. |
| `payment.receipt_id` | receipt records only | The provider's id for the settled payment, at most 256 characters |
| `payment.receipt_sig` | receipt records only | The provider's receipt signature exactly as the provider returned it, at most 8192 characters. ZipViz treats it as opaque; check it with the provider's own rules. |

### Two kinds of v=4 envelope

- **Payer envelope.** Signed by the payer before payment (`from` = `payment.payer`). It has no
  `receipt_id` or `receipt_sig`. It says: "this `.viz` agent authorizes this payment, on these
  terms, with this provider credential."
- **Receipt record.** Signed after settlement by whoever keeps the record, usually the payee
  (`from` = the payee's `.viz` name). It has `receipt_id`, and `receipt_sig` when the provider
  gives one. It is a claim by its signer that the provider settled the payment. It is not a
  provider signature, and it does not prove that funds moved on its own.

### Example

Synthetic values only. The key is the public RFC 8032 section 7.1 TEST 1 key from
[`test-vectors/verify-v1.json`](../test-vectors/verify-v1.json). Never register it or use it for
anything real. Here, `ref` is the SHA-256 of the placeholder credential
`EXAMPLE-PAYMENT-SIGNATURE-HEADER-VALUE`.

Signed string (one line):

```text
{"v":4,"from":"payer.example.test.viz","message":"","timestamp":"2026-11-20T00:00:00.000Z","payment":{"provider":"x402","payer":"payer.example.test.viz","payee":"0x1111111111111111111111111111111111111111","amount":"10000","asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","network":"eip155:84532","resource":"https://api.example.test/data","ref":"iHG7YrWWfTlQzuX-voU7wWCgvBVcwwuhvfCVAATd_Rc"}}
```

Signature (base64):

```text
pTcO+ME0WTLFf4CXLnhsT8Th3dmygbJ5wVb80xHarmynPYuwIB2kQI/uc5MzhtFVi5did9qg3gaGv250lh+aBQ==
```

It verifies with public key `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`.
Rebuilt as a v=1 string (`{v:1, from, message, timestamp}`), the same signature does not verify.

### On the wire

Over HTTP, the envelope travels as JSON: the signed fields plus `signature`, base64-encoded, in
one header.

| Header | Direction | Holds |
|---|---|---|
| `ZipViz-Payment-Identity` | Payer to payee | The payer envelope |
| `ZipViz-Payment-Receipt` | Payee to payer, optional | A receipt record |

A verifier rebuilds the signed string from the fields in the fixed order above. It never signs
or verifies the received JSON as it was serialized.

## Verifying a v=4 envelope

The payee does this before it calls the provider. Every step must pass. The codes are suggested
names for local verifiers, not API responses.

1. **Version.** `v` is `4`. Anything else is rejected (`E_VERSION`).
2. **Shape.** Every field follows the rules above, with no unknown keys at the top level or in
   `payment` (`E_SHAPE`). A new field needs a new version.
3. **Fresh.** `timestamp` is within ±5 minutes of the verifier's clock (`E_STALE`).
4. **Key.** Look up `from` with `GET /v1/agent/{domain}`. It must be registered and not suspended
   (`E_AGENT_NOT_FOUND`, `E_IDENTITY_SUSPENDED`). Cache the key for at most 60 seconds.
5. **Signature.** Ed25519 over the rebuilt signed string (`E_SIG_MISMATCH`).
6. **Payer.** In a payer envelope, `payment.payer` equals `from` (`E_SHAPE`). If `msg_id` is
   present and the payee relies on it, the direct message it names must be one the payee received
   from the same `from` (`E_PAYMENT_MISMATCH`).
7. **Binding.** `provider` is the adapter handling this request. `ref` equals the hash of the
   credential that came with this request. `payee`, `amount`, `asset`, `network` and `resource`
   equal the terms the payee offered and the URL that was requested (`E_PAYMENT_MISMATCH`).
8. **Replay.** The payee has not seen this (`from`, `ref`) pair before. Keep pairs for at least the
   freshness window plus the provider's payment timeout (`E_REPLAY`).

A valid payer envelope proves **who** authorized the payment. Only the provider's verify and
settle prove the money. If the provider then settles an amount, it must not be more than
`payment.amount`.

## Provider adapter interface

An adapter wraps one provider. It runs in the payer's or the payee's own code, next to that
provider's own SDK. ZipViz code never sees a wallet key, card or provider secret.

```ts
type PaymentTerms = {
  provider: string;   // adapter id, e.g. "x402"
  payee: string;      // payee id at the provider
  amount: string;     // smallest unit; the ceiling for up-to schemes
  asset: string;
  network?: string;   // CAIP-2
  resource?: string;  // https URL being paid for
};

type ProviderCredential = {
  terms: PaymentTerms;            // the terms this credential pays
  carrier: { name: string; value: string }; // e.g. the HTTP header, exactly as sent
};

type VerifyResult = { valid: boolean; reason?: string };
type SettleResult = {
  success: boolean;
  amount?: string;       // amount actually settled, if the provider reports it
  receipt_id?: string;
  receipt_sig?: string;
  reason?: string;
};

interface PaymentAdapter {
  readonly provider: string;

  // Payee side
  requirements(resource: string): Promise<PaymentTerms[]>;          // what the payee accepts
  verify(credential: ProviderCredential): Promise<VerifyResult>;    // delegated to the provider
  settle(credential: ProviderCredential): Promise<SettleResult>;    // delegated to the provider

  // Payer side
  pay(offered: PaymentTerms[]): Promise<ProviderCredential>;        // made by the payer's wallet or provider client
}
```

Rules:

- `verify()` and `settle()` call the provider. An adapter never decides on its own that a payment
  is valid.
- `pay()` runs with the payer's own wallet or provider account. It returns the credential and the
  terms it pays.
- The ZipViz side is two steps that are the same for every provider: sign a payer envelope over
  `terms` and `ref = SHA-256(carrier.value)`, and check one using the steps above.
- Adapters never log credentials, wallet signatures or provider tokens. Envelopes carry only the
  hash `ref`, never the credential.

## x402 reference adapter

Based on x402 version 2 (HTTP transport). [x402](https://github.com/coinbase/x402) signals payment
with HTTP 402 and three headers:

| x402 v2 header | x402 v1 name | Direction |
|---|---|---|
| `PAYMENT-REQUIRED` | (body of the 402) | Payee to payer: `PaymentRequired`, with `accepts[]` |
| `PAYMENT-SIGNATURE` | `X-PAYMENT` | Payer to payee: `PaymentPayload` |
| `PAYMENT-RESPONSE` | `X-PAYMENT-RESPONSE` | Payee to payer: `SettlementResponse` |

| Interface | x402 |
|---|---|
| `requirements()` | Answer 402 with `PAYMENT-REQUIRED`. Each `accepts[]` entry gives `payee` = `payTo`, `amount`, `asset`, `network`; `resource` = `resource.url`. |
| `pay()` | The payer's x402 client builds the scheme payload and sends `PAYMENT-SIGNATURE`. That header value is the credential `carrier`. |
| `verify()` | The facilitator's `POST /verify` with `paymentPayload` and `paymentRequirements` |
| `settle()` | The facilitator's `POST /settle`. `receipt_id` = `SettlementResponse.transaction`. If the payee uses the x402 offer-and-receipt extension, `receipt_sig` = that receipt's `signature`. |

How the identity rides along:

- **Advertise.** A payee that wants identity adds an x402 extension to `PaymentRequired`:
  `"zipviz-identity": {"info": {"required": true, "versions": [4]}, "schema": {...}}`. x402
  clients echo extension info unchanged, as x402 requires.
- **Attach.** The payer sends `ZipViz-Payment-Identity` in the same request as
  `PAYMENT-SIGNATURE`. `ref` is the SHA-256 of the `PAYMENT-SIGNATURE` value exactly as sent (for
  x402 v1, the `X-PAYMENT` value). The envelope goes in its own header so that `ref` can hash the
  whole x402 payload without hashing itself.
- **Order.** The payee checks the envelope first. Then it follows the payment flow the x402
  scheme declares (by default `/verify`, then the resource, then `/settle`). If the envelope fails
  and identity is required, the payee answers 402 again and does not call the facilitator.
- **v1 servers.** Copy `maxAmountRequired` to `amount`, and convert v1 network names (for example
  `base-sepolia`) to CAIP-2 (`eip155:84532`), as the x402 offer-and-receipt extension does.

## Other providers

These rows show that the same interface fits other agent payment providers. Provider names and
terms come from each provider's public documentation at the time of writing. They are here only
to show the mapping, and they don't imply any partnership or endorsement. Check each provider's
documentation before building an adapter.

| Interface | Skyfire (`skyfire`) | Stripe agentic commerce (`stripe-acp`) |
|---|---|---|
| `requirements()` | The seller's price and the token type it accepts (PAY or KYA-PAY) | The seller's checkout terms under the Agentic Commerce Protocol |
| `pay()` | The buyer agent gets a Skyfire token and sends it in the `skyfire-pay-id` header. That value is the `carrier`. | The agent's app gets a Shared Payment Token scoped to the seller, amount, currency and expiry. The token id is the `carrier`. |
| `verify()` | The seller validates the token's signature and claims | The seller checks the granted token and its limits with Stripe |
| `settle()` | The seller charges the token through Skyfire, at most the token amount | The seller creates a payment with Stripe using the token |
| `receipt_id` | The charge result id | The Stripe payment id |
| `asset`, `network` | From the token (for example a stablecoin and its CAIP-2 chain) | ISO 4217 currency code; no `network` |

## Security and privacy

- **Not in the money path.** ZipViz holds no funds, wallets or payment keys. The registry sees a
  key lookup, the same as for any signature, and never sees payment data.
- **Identity is not payment.** A valid payer envelope without a provider settlement is not a
  payment. A settled payment without an envelope is an anonymous payment; whether to accept it is
  the payee's choice.
- **Bound and single-use.** `ref`, the terms, the resource, the 5-minute window and the replay
  check tie one envelope to one payment. A captured envelope can't be reused for another payment,
  payee or resource.
- **No spendable data in the envelope.** It carries a hash of the credential, never the credential
  itself, so a stored or logged envelope can't be used to pay.
- **Suspended identities fail.** A payee rejects envelopes from suspended names. A stale external
  proof (`proven_by`) does not change the result, the same as for v=1.
- **Receipt records are claims.** A receipt record is only as good as its signer. Check
  `receipt_sig` with the provider's rules, including whether that provider key may sign for the
  payee.
- **Privacy.** An envelope links a `.viz` name to a payment. Payees keep only what they need, and
  `message` never carries personal data.

## Open questions

Decided: payment is its own v=4 envelope, with an optional `msg_id` that points at a v=2 or v=3
direct message (see [Envelope versions](#envelope-versions)).

1. **Other x402 transports.** Where the envelope goes, and what `ref` hashes, for x402 over MCP and
   A2A, which have no HTTP headers.
2. **Server-side check.** Keep v=4 verification local (proposed), or add a registry endpoint for
   it later?
3. **Names.** The header names `ZipViz-Payment-Identity` and `ZipViz-Payment-Receipt`, the x402
   extension key `zipviz-identity`, and how new provider ids are assigned.
