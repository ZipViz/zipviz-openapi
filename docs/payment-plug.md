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

1. The payer asks for a resource. The payee answers with its payment offers, in the provider's own
   format (`requirements()`).
2. The payer picks an offer and makes the provider payment credential (`pay()`). Then it signs a
   v=4 envelope over that offer's terms and a hash of the credential, and sends both.
3. The payee finds which of its own offers the credential pays, checks the envelope, and reserves
   the payment so it can't run twice (see [Verifying a v=4 envelope](#verifying-a-v4-envelope)).
   This is local and costs no money.
4. The payee asks the provider to verify and settle the credential against the payee's own copy of
   the offer (`verify()`, `settle()`), in the order the provider requires.
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
| `message` | yes | App text, may be empty, at most 512 bytes of UTF-8. Never put personal data or payment credentials here. |
| `timestamp` | yes | ISO-8601, within ±5 minutes of the verifier's clock |
| `msg_id` | no | The `msg_id` of the v=2 or v=3 direct message this payment belongs to, same shape (`^[A-Za-z0-9_-]{8,128}$`). It points at that message; it does not change what the message's own signature means. |
| `payment.provider` | yes | Provider id, `^[a-z0-9][a-z0-9-]{0,31}$`. This document defines `x402`, `skyfire` and `stripe-acp`. |
| `payment.payer` | yes | The payer's `.viz` name. In a payer envelope it equals `from`. |
| `payment.payee` | yes | The payee's id at the provider (x402: `payTo`), at most 256 characters |
| `payment.amount` | yes | Base-10 integer, no sign, no leading zeros, in the asset's smallest unit (x402 `amount`; minor units for fiat). For providers that charge up to a ceiling, this is the most the payer agrees to pay. |
| `payment.asset` | yes | Token contract address, or ISO 4217 code for fiat |
| `payment.network` | when the provider has one | CAIP-2 chain id (for example `eip155:8453`) |
| `payment.resource` | when the payment is for a URL | Absolute `https` URL of the resource, at most 1024 characters |
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
  provider signature, and it does not prove that funds moved on its own. Receipt records can be
  large, so they never travel in a header (see [On the wire](#on-the-wire)).

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

As a `ZipViz-Payment-Identity` header value (the signed fields plus `signature`, base64url
without padding, 667 characters, one line):

```text
eyJ2Ijo0LCJmcm9tIjoicGF5ZXIuZXhhbXBsZS50ZXN0LnZpeiIsIm1lc3NhZ2UiOiIiLCJ0aW1lc3RhbXAiOiIyMDI2LTExLTIwVDAwOjAwOjAwLjAwMFoiLCJwYXltZW50Ijp7InByb3ZpZGVyIjoieDQwMiIsInBheWVyIjoicGF5ZXIuZXhhbXBsZS50ZXN0LnZpeiIsInBheWVlIjoiMHgxMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExIiwiYW1vdW50IjoiMTAwMDAiLCJhc3NldCI6IjB4MDM2Q2JENTM4NDJjNTQyNjYzNGU3OTI5NTQxZUMyMzE4ZjNkQ0Y3ZSIsIm5ldHdvcmsiOiJlaXAxNTU6ODQ1MzIiLCJyZXNvdXJjZSI6Imh0dHBzOi8vYXBpLmV4YW1wbGUudGVzdC9kYXRhIiwicmVmIjoiaUhHN1lyV1dmVGxRenVYLXZvVTd3V0NndkJWY3d3dWh2ZkNWQUFUZF9SYyJ9LCJzaWduYXR1cmUiOiJwVGNPK01FMFdUTEZmNENYTG5oc1Q4VGgzZG15Z2JKNXdWYjgweEhhcm15blBZdXdJQjJrUUkvdWM1TXpodEZWaTVkaWQ5cWczZ2FHdjI1MGxoK2FCUT09In0
```

### On the wire

**Payer envelope over HTTP:** one request header, `ZipViz-Payment-Identity`.

- **Value.** base64url without padding (RFC 4648 section 5) of the UTF-8 bytes of a JSON object.
  The object has the signed fields (`v`, `from`, `message`, `timestamp`, `msg_id` when present,
  `payment`) plus `signature`, the base64 Ed25519 signature as in v=1. Only the characters
  `A-Z a-z 0-9 - _` appear, so the value is always a valid HTTP field value.
- **Size.** At most 4096 characters encoded and 3072 bytes decoded. A signer whose envelope would
  be larger must shorten `message` or `resource`. With the provider's own headers, that stays
  inside common limits of 8 KB per field and 16 KB for all headers.
- **Rejected without calling the provider (`E_ENCODING`):** a value over 4096 characters; any other
  character, or padding; more than 3072 decoded bytes; invalid UTF-8; JSON that does not parse, is
  not an object, or has a duplicate key where the parser can detect one. The payee answers 400,
  or 402 when its offer requires identity. A malformed envelope is never ignored and treated as
  absent.
- **Signed bytes.** A verifier rebuilds the signed string from the decoded fields in the fixed
  order above. It never verifies the received JSON as it was serialized.

**Receipt records** are never sent in a header. When they are exchanged, they go as an
`application/json` body (the same object, not base64-encoded), at most 16 KiB.

## Verifying a v=4 envelope

The payee does this before it calls the provider. Every step must pass. The codes are suggested
names for local verifiers, not API responses.

0. **Decode.** The header follows [On the wire](#on-the-wire) (`E_ENCODING`).
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
7. **Binding.** `provider` is the adapter handling this request. The adapter's `match()` finds the
   payee's **own issued offer** that the credential pays. The envelope's `payee`, `amount`,
   `asset`, `network` and `resource` equal `terms()` of that issued offer, and `resource` is the
   URL that was requested. `ref` equals the hash of the credential that came with this request
   (`E_PAYMENT_MISMATCH`).
8. **Reserve.** Atomically claim (`from`, `ref`) before any provider call. If it is already
   claimed, reject (`E_REPLAY`), except as
   [Replay reservation and retries](#replay-reservation-and-retries) allows.

A valid payer envelope proves **who** authorized the payment. Only the provider's verify and
settle prove the money. If the provider then settles an amount, it must not be more than
`payment.amount`.

### Replay reservation and retries

- **Atomic.** The claim is a single insert-if-absent, such as a unique key or a compare-and-set,
  in a store that every instance of the payee shares. A read followed by a write is not enough:
  two copies of one request could both pass the read and both reach the provider.
- **States.** A claim starts as `reserved` and ends as `settled` or `failed`. It records the
  issued offer it matched and the provider's result.
- **Keep claims** until neither the envelope nor the credential can be accepted again: the later
  of the envelope's freshness window (`timestamp` plus 5 minutes) and the credential's own expiry
  at the provider (for x402, the offer's `maxTimeoutSeconds` or the scheme's validity window). If
  the provider gives no expiry, keep claims for at least 24 hours.
- **Envelope fails before the claim.** Nothing is claimed. The payer may send a corrected
  envelope with the same credential.
- **Provider says the payment is invalid.** The claim becomes `failed`, and the same (`from`,
  `ref`) is never tried again. The payer needs a new credential.
- **Outcome unknown** (timeout, server error, lost connection). The claim stays `reserved`. A
  repeat of the same request may only resume, by calling the provider again with the **same
  idempotency key**, or by asking the provider for the outcome. It never starts a second
  settlement. If the provider offers neither, the payee does not settle again and treats the
  claim as `failed`.
- **Already settled.** A repeat gets the stored result (for x402, the same `PAYMENT-RESPONSE`) and
  is not settled again.
- **Idempotency key.** Use `ref` as the provider idempotency key wherever the provider supports
  one. Where the provider has none, the claim is the only guard, so it must be atomic.

## Provider adapter interface

An adapter wraps one provider. It runs in the payer's or the payee's own code, next to that
provider's own SDK. ZipViz code never sees a wallet key, card or provider secret.

```ts
/** The fields ZipViz signs. Always derived from an offer by terms(), never typed in by hand. */
type PaymentTerms = {
  provider: string;   // adapter id, e.g. "x402"
  payee: string;      // payee id at the provider
  amount: string;     // smallest unit; the ceiling for up-to schemes
  asset: string;
  network?: string;   // CAIP-2
  resource?: string;  // https URL being paid for
};

/** One offer, kept whole in the provider's own format, with the terms derived from it. */
type PaymentOffer = {
  provider: string;
  requirements: Readonly<Record<string, unknown>>; // the provider's offer object, every field (x402: one accepts[] entry plus resource)
  terms: PaymentTerms;                              // terms(requirements)
};

type ProviderCredential = {
  offer: PaymentOffer;                        // the offer the payer chose, as the payer saw it
  carrier: { name: string; value: string };   // e.g. the HTTP header, exactly as sent
};

type VerifyResult = { valid: boolean; reason?: string };
type SettleResult = {
  success: boolean;
  outcome: "settled" | "failed" | "unknown"; // "unknown": timeout or lost response; resume, never settle again
  amount?: string;       // amount actually settled, if the provider reports it
  receipt_id?: string;
  receipt_sig?: string;
  reason?: string;
};

interface PaymentAdapter {
  readonly provider: string;
  terms(requirements: PaymentOffer["requirements"]): PaymentTerms;   // pure and deterministic

  // Payee side
  requirements(resource: string): Promise<PaymentOffer[]>;           // the offers the payee issues
  match(carrier: ProviderCredential["carrier"], issued: PaymentOffer[]): PaymentOffer | null; // which issued offer this pays, exactly
  verify(carrier: ProviderCredential["carrier"], issued: PaymentOffer, idempotencyKey: string): Promise<VerifyResult>; // delegated to the provider
  settle(carrier: ProviderCredential["carrier"], issued: PaymentOffer, idempotencyKey: string): Promise<SettleResult>; // delegated to the provider

  // Payer side
  pay(offers: PaymentOffer[]): Promise<ProviderCredential>;          // made by the payer's wallet or provider client
}
```

Rules:

- **Offers stay whole.** `requirements` is the provider's own offer object with every field the
  provider defines (for x402 that includes `scheme`, `maxTimeoutSeconds` and `extra`). ZipViz
  never reshapes, reorders or re-serializes it, so no canonical form is needed. An adapter refuses
  any offer whose serialized form is over 16 KiB.
- **The payee's own copy rules.** The payee keeps the offers it issued, or can issue them again
  exactly. `match()` picks the one the credential pays, using the provider's own matching rule.
  `verify()` and `settle()` always get that **issued** offer, never a copy that came from the
  payer.
- **How the whole offer is bound.** The envelope signs `terms()` of the offer and `ref`, the hash
  of the credential. Offer fields outside `terms` are bound by the credential itself. Where the
  credential carries the offer (x402 puts it in `PaymentPayload.accepted`), `ref` covers it and
  `match()` compares it with the issued copy. Where the credential is a scoped provider token
  (Skyfire, Stripe), the token's own limits bind it, and the provider checks them in `verify()`.
- `verify()` and `settle()` call the provider. An adapter never decides on its own that a payment
  is valid. They take the reservation's idempotency key (`ref`) and pass it on wherever the
  provider supports one.
- `pay()` runs with the payer's own wallet or provider account. It returns the credential and the
  offer it pays.
- The ZipViz side is the same for every provider: sign a payer envelope over `offer.terms` and
  `ref = SHA-256(carrier.value)`, and check one using the steps above.
- Adapters never log credentials, wallet signatures or provider tokens. Envelopes carry only the
  hash `ref`, never the credential.

## x402 reference adapter

Based on x402 version 2 (HTTP transport). [x402](https://github.com/x402-foundation/x402) signals payment
with HTTP 402 and three headers:

| x402 v2 header | x402 v1 name | Direction |
|---|---|---|
| `PAYMENT-REQUIRED` | (body of the 402) | Payee to payer: `PaymentRequired`, with `accepts[]` |
| `PAYMENT-SIGNATURE` | `X-PAYMENT` | Payer to payee: `PaymentPayload` |
| `PAYMENT-RESPONSE` | `X-PAYMENT-RESPONSE` | Payee to payer: `SettlementResponse` |

| Interface | x402 |
|---|---|
| `requirements()` | Answer 402 with `PAYMENT-REQUIRED`. Each `accepts[]` entry, kept whole with the `resource` object, is one offer's `requirements`. |
| `terms()` | `payee` = `payTo`, `amount`, `asset`, `network`; `resource` = `resource.url` |
| `pay()` | The payer's x402 client picks an `accepts[]` entry, builds the scheme payload with `accepted` set to that entry, and sends `PAYMENT-SIGNATURE`. That header value is the credential `carrier`. |
| `match()` | Decode `PAYMENT-SIGNATURE`. Its `accepted` must equal one of the payee's issued `accepts[]` entries, field for field, as x402 requires. |
| `verify()` | The facilitator's `POST /verify` with `paymentPayload` and the payee's **issued** entry as `paymentRequirements` |
| `settle()` | The facilitator's `POST /settle`, with the same issued entry. `receipt_id` = `SettlementResponse.transaction`. If the payee uses the x402 offer-and-receipt extension, `receipt_sig` = that receipt's `signature`. |
| Idempotency | If the payer includes the x402 `payment-identifier` extension, facilitators that support it deduplicate on that id. In every case the payee's atomic (`from`, `ref`) claim stops a second settlement. |

How the identity rides along:

- **Advertise.** A payee that wants identity adds an x402 extension to `PaymentRequired`:
  `"zipviz-identity": {"info": {"required": true, "versions": [4]}, "schema": {...}}`. x402
  clients echo extension info unchanged, as x402 requires.
- **Attach.** The payer sends `ZipViz-Payment-Identity` in the same request as
  `PAYMENT-SIGNATURE`. `ref` is the SHA-256 of the `PAYMENT-SIGNATURE` value exactly as sent (for
  x402 v1, the `X-PAYMENT` value). The envelope goes in its own header so that `ref` can hash the
  whole x402 payload without hashing itself.
- **Order.** The payee checks and claims the envelope first. Then it follows the payment flow the
  x402 scheme declares (by default `/verify`, then the resource, then `/settle`). If the envelope
  fails and identity is required, the payee answers 402 again and does not call the facilitator.
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
| `pay()` | The buyer agent gets a Skyfire token and sends it in the `kyapay-token` header. That value is the `carrier`. Older integrations use `skyfire-pay-id`, which Skyfire marks deprecated; accept it only as a legacy alias, and hash whichever header carried the token. | The agent's app gets a Shared Payment Token scoped to the seller, amount, currency and expiry. The token id is the `carrier`. |
| `verify()` | The seller validates the token's signature and claims | The seller checks the granted token and its limits with Stripe |
| `settle()` | The seller charges the token through Skyfire, at most the token amount | The seller creates a payment with Stripe using the token |
| `receipt_id` | The charge result id | The Stripe payment id |
| Idempotency | No charge idempotency key is documented at the time of writing, so the atomic claim is the guard | Stripe's `Idempotency-Key` request header, set to `ref` |
| `asset`, `network` | From the token (for example a stablecoin and its CAIP-2 chain) | ISO 4217 currency code; no `network` |

## Security and privacy

- **Not in the money path.** ZipViz holds no funds, wallets or payment keys. The registry sees a
  key lookup, the same as for any signature, and never sees payment data.
- **Identity is not payment.** A valid payer envelope without a provider settlement is not a
  payment. A settled payment without an envelope is an anonymous payment; whether to accept it is
  the payee's choice.
- **Bound and single-use.** `ref`, the terms, the resource, the 5-minute window and the atomic
  (`from`, `ref`) claim tie one envelope to one payment. A captured envelope can't be reused for
  another payment, payee or resource, and two copies sent at once can't both settle.
- **The payee's offer is the authority.** The provider verifies and settles against the offer the
  payee issued, never one the payer sends back.
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
3. **Names.** The header name `ZipViz-Payment-Identity`, the x402 extension key
   `zipviz-identity`, and how new provider ids are assigned.
