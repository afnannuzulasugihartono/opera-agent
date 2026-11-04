// @last-edited: 2026-11-04 UTC+7.
// @title: qris — the merchant's static QRIS payload turned into a dynamic one with the amount locked.
// @state: TLV parse and serialize, CRC16-CCITT-FALSE, and the one conversion that was proven accepted by a payer app on 2026-11-02.
// @dependencies: none.

// WHY THE PAYLOAD IS EDITED AS TAGS AND NOT AS A STRING.
// The probe on 2026-11-02 proved the payer side rejects a payload whose tag 01 says dynamic but whose category tag still says static: "QR code tidak sah".
// Editing substrings would reproduce exactly that half-edited payload, so every change goes through the tag list and the CRC is recomputed over the whole result.

// WHY THE AMOUNT IS A WHOLE RUPIAH STRING.
// Tag 54 carries "1000" for Rp 1.000, and "1000.00" was not the accepted form; the rupiah has no subunit in a QRIS payload, so the amount is integer rupiah and nothing else.

export function crc16CcittFalse(text) {
  let crc = 0xffff;
  const bytes = new TextEncoder().encode(text);
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// WHY THE CRC IS COMPUTED OVER THE PAYLOAD WITH A BARE TAG 63.
// The checksum covers everything before it, so the running payload ends with "6304" and the four hex digits are appended after.

export function parseQris(payload) {
  if (typeof payload !== 'string' || payload.length < 4) return [];
  const fields = [];
  let at = 0;
  while (at + 4 <= payload.length) {
    const tag = payload.slice(at, at + 2);
    const length = Number(payload.slice(at + 2, at + 4));
    if (!Number.isInteger(length) || length < 0) return [];
    const value = payload.slice(at + 4, at + 4 + length);
    if (value.length !== length) return [];
    fields.push({ tag, value });
    at += 4 + length;
  }
  return at === payload.length ? fields : [];
}

export function serializeQris(fields) {
  return fields.map((field) => `${field.tag}${String(field.value.length).padStart(2, '0')}${field.value}`).join('');
}

function setField(fields, tag, value) {
  const existing = fields.find((field) => field.tag === tag);
  if (existing) existing.value = value;
  else fields.push({ tag, value });
}

// WHY TAG 54 IS PLACED BEFORE TAG 58 AND NOT APPENDED BLINDLY.
// The accepted dynamic form measured on 2026-11-02 had tag 54 before tag 58; a payload with the amount after the country tag was not the one that was scanned and accepted.

function insertAmount(fields, amount) {
  const without = fields.filter((field) => field.tag !== '54');
  const at = without.findIndex((field) => field.tag === '58');
  const field = { tag: '54', value: String(amount) };
  if (at === -1) without.push(field);
  else without.splice(at, 0, field);
  return without;
}

export function toDynamicQris(staticPayload, amountRupiah) {
  if (!Number.isInteger(amountRupiah) || amountRupiah <= 0) return null;
  const parsed = parseQris(staticPayload);
  if (!parsed.length) return null;
  if (parsed[0]?.tag !== '00' || parsed[0].value !== '02') return null;

  let fields = parsed.filter((field) => field.tag !== '63');
  setField(fields, '01', '12');
  fields = insertAmount(fields, amountRupiah);

  // WHY THE CATEGORY LIVES IN TAG 62/07.
  // Tag 62/07 is the QRIS category: A01 static, A02 dynamic.
  // The 2026-11-02 probe showed changing only tag 01 is refused, so the category is set here, inside 62.
  const category = fields.find((field) => field.tag === '62');
  if (category) {
    const sub = parseQris(category.value).filter((field) => field.tag !== '07');
    sub.push({ tag: '07', value: 'A02' });
    category.value = serializeQris(sub);
  } else {
    fields.push({ tag: '62', value: '0703A02' });
  }

  const body = serializeQris(fields);
  return `${body}6304${crc16CcittFalse(`${body}6304`)}`;
}

export function qrisAmount(payload) {
  const field = parseQris(payload).find((entry) => entry.tag === '54');
  const amount = Number(field?.value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
}

export function qrisCategory(payload) {
  const field = parseQris(payload).find((entry) => entry.tag === '62');
  const sub = field ? parseQris(field.value).find((entry) => entry.tag === '07') : null;
  return sub?.value ?? null;
}
