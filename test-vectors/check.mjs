// Checks test-vectors/verify-v1.json offline. Node built-ins only, no dependencies.
//
// Run:  node test-vectors/check.mjs
//
// TEST ONLY: the keys used here are the public RFC 8032 section 7.1 test keys.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const WINDOW_MS = 5 * 60 * 1000;
const PKCS8_PREFIX = '302e020100300506032b657004220420'; // Ed25519 PKCS#8, followed by the 32-byte seed
const SPKI_PREFIX = '302a300506032b6570032100'; // Ed25519 SPKI, followed by the 32-byte public key

const doc = JSON.parse(readFileSync(new URL('./verify-v1.json', import.meta.url), 'utf8'));

const privateKey = (hex) =>
  createPrivateKey({ key: Buffer.from(PKCS8_PREFIX + hex, 'hex'), format: 'der', type: 'pkcs8' });
const publicKey = (hex) =>
  createPublicKey({ key: Buffer.from(SPKI_PREFIX + hex, 'hex'), format: 'der', type: 'spki' });
const derivePublicHex = (secretHex) =>
  createPublicKey(privateKey(secretHex)).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');

// The v1 rule: UTF-8 bytes of JSON.stringify({v: 1, from, message, timestamp}), in that key order.
const signedBytes = ({ from, message, timestamp }) =>
  Buffer.from(JSON.stringify({ v: 1, from, message, timestamp }), 'utf8');

// Reference verifier. Mirrors POST /v1/verify: E_STALE when the timestamp is outside
// +/-5 minutes of `now`, E_SIG_MISMATCH when the signature does not verify.
function referenceVerify(request, publicKeyHex, now) {
  const skew = Math.abs(Date.parse(now) - Date.parse(request.timestamp));
  if (!(skew <= WINDOW_MS)) return { valid: false, reason: 'E_STALE' };
  const sig = Buffer.from(request.signature, 'base64');
  if (sig.length !== 64) return { valid: false, reason: 'E_SIG_FORMAT' };
  const ok = verify(null, signedBytes(request), publicKey(publicKeyHex), sig);
  return ok ? { valid: true, reason: null } : { valid: false, reason: 'E_SIG_MISMATCH' };
}

let checks = 0;
const failures = [];
function check(label, fn) {
  checks += 1;
  try {
    fn();
  } catch (err) {
    failures.push(`${label}: ${err.message.split('\n')[0]}`);
  }
}

// 1. Key material: Node derives the RFC 8032 public keys from the RFC secret keys.
const RFC = {
  'TEST 1': {
    secret: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    public: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  },
  'TEST 2': {
    secret: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    public: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
  },
};
for (const [name, k] of Object.entries(RFC)) {
  check(`${name} key pair matches RFC 8032`, () => {
    assert.equal(derivePublicHex(k.secret), k.public);
    assert.deepEqual(doc.test_keys[name], {
      source: `RFC 8032 section 7.1, ${name}`,
      secret_key: k.secret,
      public_key: k.public,
    });
  });
}
check('RFC 8032 TEST 1 known answer (empty message)', () => {
  const expected =
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
  assert.equal(sign(null, Buffer.alloc(0), privateKey(RFC['TEST 1'].secret)).toString('hex'), expected);
});

// 2. The file has exactly the 8 required cases.
const EXPECTED_NAMES = [
  'valid',
  'message_tampered',
  'from_tampered',
  'signature_from_different_key',
  'keys_in_wrong_order',
  'timestamp_6_minutes_old',
  'timestamp_6_minutes_future',
  'non_ascii_message',
];
check('case names', () => assert.deepEqual(doc.cases.map((c) => c.name), EXPECTED_NAMES));

// 3. Every case.
for (const c of doc.cases) {
  const signer = RFC[c.signed_with];
  check(`${c.name}: fields`, () => {
    assert.ok(signer, `unknown signed_with ${c.signed_with}`);
    assert.equal(c.public_key, RFC['TEST 1'].public);
    assert.ok(/^[0-9a-f]{64}$/.test(c.public_key));
    assert.deepEqual(Object.keys(c.request), ['from', 'message', 'timestamp', 'signature']);
    assert.ok(c.request.from === 'example.test.viz' || c.request.from.endsWith('.example.test.viz'));
    assert.equal(Buffer.from(c.request.signature, 'base64').length, 64);
    assert.equal(Buffer.from(c.request.signature, 'base64').toString('base64'), c.request.signature);
    assert.equal(new Date(c.request.timestamp).toISOString(), c.request.timestamp);
    assert.equal(new Date(c.now).toISOString(), c.now);
  });

  // The recorded signed string is what a correct verifier rebuilds from the request.
  check(`${c.name}: signed_string is rebuilt from the request`, () => {
    assert.equal(c.signed_string, signedBytes(c.request).toString('utf8'));
    assert.ok(c.signed_string.startsWith('{"v":1,"from":'));
  });

  // The verdict of a reference verifier matches the recorded one.
  check(`${c.name}: verdict`, () => {
    assert.deepEqual(referenceVerify(c.request, c.public_key, c.now), c.expected);
  });

  // Ed25519 is deterministic: the signer's secret reproduces the signature byte for byte
  // over the bytes the signature was made over (the signed string unless a fault was injected).
  const madeOver = c.signature_made_over ?? c.signed_string;
  check(`${c.name}: signature reproduces byte for byte`, () => {
    const sig = sign(null, Buffer.from(madeOver, 'utf8'), privateKey(signer.secret));
    assert.equal(sig.toString('base64'), c.request.signature);
  });

  // Each failing case has one fault, so the signature is genuine over what it was made over.
  check(`${c.name}: signature is genuine for the signer`, () => {
    const sig = Buffer.from(c.request.signature, 'base64');
    assert.equal(verify(null, Buffer.from(madeOver, 'utf8'), publicKey(signer.public), sig), true);
  });
}

// 4. Per-case properties that name the fault.
const byName = Object.fromEntries(doc.cases.map((c) => [c.name, c]));
const valid = byName.valid;
const skewMs = (c) => Date.parse(c.request.timestamp) - Date.parse(c.now);

check('valid: unmodified, TEST 1, inside the window', () => {
  assert.equal(valid.expected.valid, true);
  assert.equal(valid.signed_with, 'TEST 1');
  assert.equal(valid.signature_made_over, undefined);
  assert.ok(Math.abs(skewMs(valid)) <= WINDOW_MS);
});
check('message_tampered: only message differs from valid', () => {
  const c = byName.message_tampered;
  assert.notEqual(c.request.message, valid.request.message);
  assert.equal(c.request.signature, valid.request.signature);
  assert.equal(c.signature_made_over, valid.signed_string);
});
check('from_tampered: only from differs from valid', () => {
  const c = byName.from_tampered;
  assert.notEqual(c.request.from, valid.request.from);
  assert.equal(c.request.signature, valid.request.signature);
  assert.equal(c.signature_made_over, valid.signed_string);
});
check('signature_from_different_key: signed by TEST 2, same bytes as valid', () => {
  const c = byName.signature_from_different_key;
  assert.equal(c.signed_with, 'TEST 2');
  assert.equal(c.signed_string, valid.signed_string);
  assert.notEqual(c.request.signature, valid.request.signature);
});
check('keys_in_wrong_order: signed over a different key order', () => {
  const c = byName.keys_in_wrong_order;
  const { from, message, timestamp } = c.request;
  assert.equal(c.signature_made_over, JSON.stringify({ v: 1, message, from, timestamp }));
  assert.notEqual(c.signature_made_over, c.signed_string);
  assert.deepEqual(
    Object.keys(JSON.parse(c.signature_made_over)).sort(),
    Object.keys(JSON.parse(c.signed_string)).sort(),
  );
  assert.equal(c.request.message, valid.request.message);
});
check('timestamp_6_minutes_old: 6 minutes before now', () => {
  assert.equal(skewMs(byName.timestamp_6_minutes_old), -6 * 60 * 1000);
});
check('timestamp_6_minutes_future: 6 minutes after now', () => {
  assert.equal(skewMs(byName.timestamp_6_minutes_future), 6 * 60 * 1000);
});
check('non_ascii_message: multi-byte UTF-8, written raw and signed byte-exact', () => {
  const c = byName.non_ascii_message;
  const bytes = signedBytes(c.request);
  assert.equal(c.expected.valid, true);
  assert.ok(/[^\x00-\x7f]/.test(c.request.message));
  assert.ok(/\p{Extended_Pictographic}/u.test(c.request.message));
  assert.ok(bytes.length > c.signed_string.length, 'expected multi-byte characters');
  assert.ok(!c.signed_string.includes('\\u'), 'non-ASCII must not be \\u-escaped');
  // The same signature must NOT verify over a \u-escaped payload.
  const escaped = c.signed_string.replace(/[^\x00-\x7f]/g, (ch) =>
    ch.split('').map((u) => '\\u' + u.charCodeAt(0).toString(16).padStart(4, '0')).join(''));
  assert.notEqual(escaped, c.signed_string);
  assert.equal(
    verify(null, Buffer.from(escaped, 'utf8'), publicKey(c.public_key), Buffer.from(c.request.signature, 'base64')),
    false,
  );
});

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} of ${checks} checks failed`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`ok: ${doc.cases.length} cases, ${checks} checks passed`);
for (const c of doc.cases) {
  console.log(`  ${c.name.padEnd(30)} valid=${String(c.expected.valid).padEnd(5)} reason=${c.expected.reason}`);
}
