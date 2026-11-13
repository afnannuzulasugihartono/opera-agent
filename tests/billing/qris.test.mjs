// @last-edited: 2026-11-04 UTC+7.
// @title: qris — the conversion the payer app accepted on 2026-11-02, pinned tag by tag.
// @state: the CRC anchor, the parse round-trip, and the dynamic form: tag 01 12, tag 54 whole rupiah before tag 58, tag 62/07 A02, CRC recomputed.
// @dependencies: node:test, node:assert/strict, ../hosted/functions/_shared/qris.js.

// WHY THE CANONICAL VECTOR ANCHORS THE CRC.
// The probe on 2026-11-02 measured F47E as the CRC of the real merchant payload, but the full payload lives only on the owner's phone screenshot.
// CRC16-CCITT-FALSE of "123456789" is 29B1 in every published table, so that vector proves the algorithm, and the structural tests prove the conversion.

import test from 'node:test';
import assert from 'node:assert/strict';
import { crc16CcittFalse, parseQris, serializeQris, toDynamicQris, qrisAmount, qrisCategory } from '../../hosted/functions/_shared/qris.js';

// A merchant-shaped static payload: tag 00, tag 01 static, a merchant tag 26, a country tag 58, category tag 62/07 A01, and a CRC.

function staticPayload() {
  const fields = [
    { tag: '00', value: '01' },
    { tag: '01', value: '11' },
    { tag: '26', value: '0014COM.GO-JEK.WWW' },
    { tag: '52', value: '5204' },
    { tag: '58', value: 'ID' },
    { tag: '62', value: '0703A01' }
  ];
  const body = serializeQris(fields);
  return `${body}6304${crc16CcittFalse(`${body}6304`)}`;
}

test('the CRC matches the published CCITT-FALSE vector', () => {
  assert.equal(crc16CcittFalse('123456789'), '29B1');
});

test('parse and serialize round-trip a payload', () => {
  const payload = staticPayload();
  const fields = parseQris(payload);
  assert.equal(serializeQris(fields), payload);
  assert.equal(fields.at(-1).tag, '63');
  assert.equal(fields.at(-1).value.length, 4);
});

test('a static payload converts to the dynamic form BRImo accepted on 2026-11-04', () => {
  const dynamic = toDynamicQris(staticPayload(), 1000);
  assert.ok(dynamic, 'the conversion must produce a payload');
  const fields = parseQris(dynamic);
  assert.equal(fields.find((f) => f.tag === '01').value, '12', 'tag 01 must say dynamic');
  assert.equal(fields.find((f) => f.tag === '54').value, '1000', 'the amount is a whole rupiah string; BRImo refused "1000.00" with kode th 03');
  assert.equal(qrisCategory(dynamic), 'A01', 'tag 62/07 is left as the merchant printed it: BRImo accepted A01 and refused A02, ShopeePay the reverse, so the acquirer-issued value wins');
  assert.equal(qrisAmount(dynamic), 1000);
  const body = serializeQris(fields.filter((f) => f.tag !== '63'));
  assert.equal(fields.at(-1).value, crc16CcittFalse(`${body}6304`), 'the CRC must cover everything before tag 63');
});

test('the amount tag lands before the country tag, the order that was scanned and accepted', () => {
  const dynamic = toDynamicQris(staticPayload(), 10000);
  const tags = parseQris(dynamic).map((f) => f.tag);
  assert.ok(tags.indexOf('54') < tags.indexOf('58'), `tag 54 must come before tag 58, got ${tags.join(',')}`);
});

test('a merchant payload without tag 62 stays without one', () => {
  const fields = [
    { tag: '00', value: '01' },
    { tag: '01', value: '11' },
    { tag: '26', value: '0014COM.GO-JEK.WWW' }
  ];
  const body = serializeQris(fields);
  const dynamic = toDynamicQris(`${body}6304${crc16CcittFalse(`${body}6304`)}`, 10000);
  assert.equal(qrisCategory(dynamic), null, 'the conversion must not invent a category tag the merchant never printed');
  assert.equal(qrisAmount(dynamic), 10000);
});

test('the conversion refuses what it cannot price', () => {
  assert.equal(toDynamicQris(staticPayload(), 1000.5), null, 'a fractional rupiah has no QRIS form');
  assert.equal(toDynamicQris(staticPayload(), 0), null);
  assert.equal(toDynamicQris('not-a-payload', 1000), null);
  assert.equal(toDynamicQris('0002AB0101021121', 1000), null, 'tag 00 must be the payload format indicator 01');
});

test('a payload whose CRC does not match is detectable', () => {
  const payload = staticPayload();
  const tampered = `${payload.slice(0, -4)}0000`;
  const fields = parseQris(tampered);
  const body = serializeQris(fields.filter((f) => f.tag !== '63'));
  assert.notEqual(fields.at(-1).value, crc16CcittFalse(`${body}6304`), 'a rewritten amount without a new CRC is detectable');
});
