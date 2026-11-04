// @last-edited: 2026-11-04 UTC+7.
// @title: qris-detector — read the merchant feed and match money in to open invoices, in dry mode until the units are proven.
// @state: the feed query and headers that were accepted on 2026-11-02, the feed parser, exact-amount FIFO matching in both amount units, and the dry/live plan.
// @dependencies: none.

// WHY THE DETECTOR MATCHES BY AMOUNT AND NOT BY A UNIQUE CODE.
// That was the owner's decision in the 2026-11-02 spec: exact amount plus first-in-first-out, no magic number in the payment.
// It means a wrong match is possible in principle, which is exactly why the mode is dry until the feed's amount unit is measured from real transactions.

// WHY BOTH AMOUNT UNITS ARE TRIED.
// Whether the feed reports rupiah or minor units was never verified, and a wrong guess closes the wrong invoice.
// So a run reports matches under both readings, and only a measured unit ever goes live.

export const FEED_URL = 'https://api.gojekapi.com/merchant-analytics/v2/merchants/transactions';
export const TOKEN_URL = 'https://api.gobiz.co.id/goid/token';

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export function feedQuery({ merchantId, from = 0, size = 50, startTime, endTime }) {
  if (!merchantId) return null;
  if (!Number.isInteger(from) || from < 0) return null;
  if (!Number.isInteger(size) || size < 1 || size > 200) return null;
  if (!RFC3339.test(String(startTime || '')) || !RFC3339.test(String(endTime || ''))) return null;
  const params = new URLSearchParams({
    merchant_id: String(merchantId),
    from: String(from),
    size: String(size),
    start_time: String(startTime),
    end_time: String(endTime)
  });
  return params.toString();
}

// WHY x-uniqueid IS A PARAMETER AND NOT A CONSTANT.
// The 2026-11-02 probe measured that a new UUID per call is refused with 401: the server binds the session to one device id.
// So the id is a session property held with the token, and one id per deployed detector.

export function feedHeaders({ accessToken, uniqueId }) {
  if (!accessToken || !uniqueId) return null;
  return {
    authorization: `Bearer ${accessToken}`,
    'x-uniqueid': String(uniqueId),
    'X-AppVersion': '5.12.0',
    'x-appId': 'com.gojek.gopay',
    'X-Platform': 'gojek',
    'x-DeviceOS': 'Android',
    'X-User-Type': 'consumer',
    'Gojek-Country-Code': 'ID',
    'Gojek-Timezone': 'Asia/Jakarta'
  };
}

export function parseFeed(body) {
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.transactions) ? body.transactions : [];
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const amount = Number(row.amount ?? row.nominal ?? row.total);
    const at = String(row.created_at ?? row.transaction_time ?? row.time ?? '');
    if (!Number.isFinite(amount)) continue;
    out.push({
      id: String(row.id ?? row.transaction_id ?? `${at}:${amount}`),
      amount,
      at,
      method: String(row.payment_method ?? row.method ?? ''),
      status: String(row.status ?? '')
    });
  }
  return out;
}

// WHY MATCHING IS EXACT AMOUNT, FIFO, ONE TRANSACTION PER INVOICE.
// Each transaction closes at most one invoice and each invoice needs one transaction; consuming a transaction prevents the same money closing two invoices.

export function matchOpenInvoices(invoices, transactions, unit) {
  const scale = unit === 'minor' ? 100 : 1;
  const open = (Array.isArray(invoices) ? invoices : [])
    .filter((invoice) => String(invoice.status || '') === 'open')
    .map((invoice) => ({ invoice, cents: Number(invoice.amount_cents) }))
    .sort((a, b) => String(a.invoice.created_at).localeCompare(String(b.invoice.created_at)));
  const used = new Set();
  const matches = [];
  for (const entry of open) {
    const wantRupiah = entry.cents / 100;
    const hit = transactions.find((tx) => !used.has(tx.id) && tx.amount / scale === wantRupiah);
    if (hit) {
      used.add(hit.id);
      matches.push({ invoiceId: entry.invoice.id, transactionId: hit.id, amountRupiah: wantRupiah, at: hit.at, method: hit.method });
    }
  }
  return matches;
}

// WHY THE PLAN IS A SEPARATE FUNCTION.
// Dry mode must be indistinguishable in shape from live mode, so the only difference is what happens to the matches.
// A detector that behaves differently in dry mode would prove nothing about live mode.

export function detectorPlan(mode, matchesByUnit) {
  const live = String(mode || 'dry').toLowerCase() === 'live';
  return {
    mode: live ? 'live' : 'dry',
    closes: live ? (matchesByUnit.rupiah.length ? matchesByUnit.rupiah : matchesByUnit.minor) : [],
    wouldClose: live ? [] : (matchesByUnit.rupiah.length ? matchesByUnit.rupiah : matchesByUnit.minor),
    rupiahMatches: matchesByUnit.rupiah,
    minorMatches: matchesByUnit.minor
  };
}
