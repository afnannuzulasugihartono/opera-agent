// @last-edited: 2026-11-04 UTC+7.
// @title: wallet-api — the six answers a wallet gives, and the order they are given in.
// @state: the routing of wallet and task actions, the owner that comes from the request and never from the body, and the status each refusal deserves.
// @dependencies: ./wallet.ts.

// WHY THE HANDLERS ARE HERE AND NOT IN THE FUNCTION THAT SERVES THEM.
// The function owns secrets and the database client; this module owns the order of decisions, and that order is what decides whether a refusal happens before or after money is promised.
// Keeping the order here lets a test drive every branch without a network, a provider or a key.
// The dependency object is the whole surface: a caller that cannot be shown a helper cannot be tested for calling it in the wrong order.

// WHY THE OWNER IS A PARAMETER OF THE CALL AND NOT A FIELD OF THE BODY.
// A body is what the caller wrote, so an owner read from it is an owner the caller chose.
// Every action below takes the owner from the resolver the function gives it, which reads a signed session or a paired device and nothing else.

import { DEPOSIT_KIND, quotePlan } from './wallet.ts';

const SHA256_HEX = /^[0-9a-f]{64}$/;
const RESERVATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const WALLET_ACTIONS = Object.freeze([
  'wallet-balance',
  'wallet-history',
  'wallet-quote',
  'wallet-deposit',
  'task-reserve',
  'task-settle',
  'task-refund'
]);

export function isWalletAction(action) {
  return WALLET_ACTIONS.includes(String(action || ''));
}

function refusal(why, extra = {}) {
  return { status: 409, body: { ok: false, why, ...extra } };
}

// WHY A QUOTE IS SERVED BEFORE A RESERVE RATHER THAN INSIDE IT.
// The person sees the price, the number of chunks and the balance they will have left before they agree to anything.
// A reserve that both priced and committed would make the first sight of the number the moment the money was already spoken for.

export async function handleWalletAction(action, body, deps) {
  const owner = await deps.owner(body);
  if (!owner) {
    return { status: 401, body: { ok: false, why: 'sign in, or pair a device, before using a wallet' } };
  }
  const prices = async () => await deps.prices();
  if (action === 'wallet-balance') {
    const [balanceCents, availableCents] = await Promise.all([deps.balance(owner), deps.available(owner)]);
    return { status: 200, body: { ok: true, balanceCents, availableCents, currency: 'IDR' } };
  }
  if (action === 'wallet-history') {
    const entries = await deps.history(owner);
    return { status: 200, body: { ok: true, entries } };
  }
  if (action === 'wallet-quote') {
    const quote = quotePlan(body.plan, await prices());
    if (!quote.ok) return refusal(quote.why, { quote });
    const availableCents = await deps.available(owner);
    return { status: 200, body: { ok: true, quote, availableCents } };
  }
  if (action === 'wallet-deposit') {
    const opened = await deps.depositTopUp(owner);
    return { status: 200, body: { ok: true, ...opened, kind: DEPOSIT_KIND } };
  }
  if (action === 'task-reserve') {
    const quote = quotePlan(body.plan, await prices());
    if (!quote.ok) return refusal(quote.why, { quote });
    const reserved = await deps.reserve({
      owner,
      kind: quote.kind,
      amountCents: quote.amountCents,
      actionsPlanned: Math.max(1, quote.stepsPerChunk)
    });
    if (!reserved.ok && reserved.why === 'insufficient') {
      return { status: 402, body: { ok: false, why: 'insufficient', quote, availableCents: reserved.availableCents } };
    }
    if (!reserved.ok) return refusal(reserved.why, { quote });
    return { status: 200, body: { ok: true, reservation: reserved, quote } };
  }
  if (action === 'task-settle') {
    const reservationId = String(body.reservation_id || '');
    const artifactHash = String(body.artifact_hash || '').toLowerCase();
    if (!RESERVATION_ID.test(reservationId)) return { status: 400, body: { ok: false, why: 'bad-reservation-id' } };
    if (!SHA256_HEX.test(artifactHash)) return { status: 400, body: { ok: false, why: 'bad-artifact-hash' } };
    const settled = await deps.settle({
      owner,
      reservationId,
      artifactHash,
      actionsActual: Number.isInteger(body.actions_actual) ? body.actions_actual : null
    });
    if (!settled.ok) return refusal(settled.why);
    return { status: 200, body: { ok: true, ...settled } };
  }
  const reservationId = String(body.reservation_id || '');
  if (!RESERVATION_ID.test(reservationId)) return { status: 400, body: { ok: false, why: 'bad-reservation-id' } };
  const refunded = await deps.refund({ owner, reservationId, reason: String(body.reason || '').slice(0, 200) || null });
  if (!refunded.ok) return refusal(refunded.why);
  return { status: 200, body: { ok: true, ...refunded } };
}
