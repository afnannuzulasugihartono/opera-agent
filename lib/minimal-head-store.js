import { DatabaseSync } from 'node:sqlite';

import { validateLedger } from './goal-ledger.js';

const SHA256_HEX = /^sha256:[0-9a-f]{64}$/;
const TERMINAL_STATUSES = new Set(['CANCELLED', 'EXPIRED']);
const COLUMNS = Object.freeze([
  'tenant_id', 'goal_id', 'head_revision', 'head_digest', 'status',
  'created_at', 'updated_at', 'expires_at',
]);

function storeError(code, message) {
  const error = new Error(message);
  error.name = 'MinimalHeadStoreError';
  error.code = code;
  return error;
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function openMinimalHeadStore(databasePath) {
  if (typeof databasePath !== 'string' || !databasePath) throw storeError('INVALID_VALUE', 'A database path is required.');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS goal_heads (
      tenant_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      head_revision INTEGER NOT NULL,
      head_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, goal_id)
    ) WITHOUT ROWID;
  `);
  const select = database.prepare('SELECT * FROM goal_heads WHERE tenant_id = ? AND goal_id = ?');
  const insert = database.prepare(`INSERT INTO goal_heads (${COLUMNS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = database.prepare(`
    UPDATE goal_heads SET head_revision = ?, head_digest = ?, status = ?, updated_at = ?, expires_at = ?
    WHERE tenant_id = ? AND goal_id = ? AND head_revision = ? AND head_digest = ?
  `);

  return Object.freeze({
    async commitHead(ledgerInput, options = {}) {
      const ledger = await validateLedger(ledgerInput);
      if (!validTimestamp(options.now)) throw storeError('INVALID_VALUE', 'options.now must be a timestamp.');
      const current = select.get(ledger.tenantId, ledger.goalId);
      if (!current) {
        if (ledger.revision !== 1 || options.expectedRevision !== undefined || options.expectedDigest !== undefined) {
          throw storeError('FORKED_REVISION', 'A new persisted head must begin at revision 1.');
        }
        insert.run(
          ledger.tenantId, ledger.goalId, ledger.revision, ledger.ledgerDigest,
          ledger.status, ledger.createdAt, options.now, ledger.expiresAt,
        );
        return { committed: true, revision: ledger.revision, digest: ledger.ledgerDigest };
      }
      if (TERMINAL_STATUSES.has(current.status)) throw storeError('TERMINAL_LEDGER', 'A terminal persisted head cannot be revised.');
      if (!Number.isSafeInteger(options.expectedRevision) || !SHA256_HEX.test(options.expectedDigest || '')) {
        throw storeError('INVALID_VALUE', 'Expected head revision and digest are required.');
      }
      if (options.expectedRevision < current.head_revision) throw storeError('STALE_REVISION', 'Expected revision is stale.');
      if (options.expectedRevision > current.head_revision || options.expectedDigest !== current.head_digest) {
        throw storeError('FORKED_REVISION', 'Expected head does not match the persisted head.');
      }
      if (ledger.revision !== current.head_revision + 1 || ledger.parentDigest !== current.head_digest) {
        throw storeError('FORKED_REVISION', 'Ledger is not the direct child of the persisted head.');
      }
      if (Date.parse(options.now) < Date.parse(current.updated_at)) throw storeError('STALE_TIMESTAMP', 'Head time cannot move backwards.');
      if (!TERMINAL_STATUSES.has(ledger.status) && Date.parse(options.now) >= Date.parse(ledger.expiresAt)) {
        throw storeError('EXPIRED', 'An expired open head cannot be committed.');
      }
      const result = update.run(
        ledger.revision, ledger.ledgerDigest, ledger.status, options.now, ledger.expiresAt,
        ledger.tenantId, ledger.goalId, current.head_revision, current.head_digest,
      );
      if (result.changes !== 1) throw storeError('FORKED_REVISION', 'Persisted head changed during commit.');
      return { committed: true, revision: ledger.revision, digest: ledger.ledgerDigest };
    },

    verifyHeadToken(token, options = {}) {
      if (!token || typeof token !== 'object' || !validTimestamp(options.now)) return { valid: false, reason: 'INVALID_TOKEN' };
      const current = select.get(token.tenantId, token.goalId);
      if (!current || !Number.isSafeInteger(token.revision) || !SHA256_HEX.test(token.digest || '')) return { valid: false, reason: 'INVALID_TOKEN' };
      if (token.revision < current.head_revision) return { valid: false, reason: 'STALE_REVISION' };
      if (token.revision > current.head_revision || token.digest !== current.head_digest) return { valid: false, reason: 'FORKED_REVISION' };
      if (TERMINAL_STATUSES.has(current.status)) return { valid: false, reason: 'TERMINAL_LEDGER' };
      if (Date.parse(options.now) >= Date.parse(current.expires_at)) return { valid: false, reason: 'EXPIRED' };
      return { valid: true, status: current.status };
    },

    columns() {
      return database.prepare('PRAGMA table_info(goal_heads)').all().map((column) => column.name);
    },

    close() {
      database.close();
    },
  });
}
