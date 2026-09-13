import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';

// Mandatory real native PostgreSQL gate. Missing tooling is a failure, not a skip.
const run = promisify(execFile);
const bin = process.env.OPERA_PG_BIN;
if (!bin || !path.isAbsolute(bin)) throw new Error('Set OPERA_PG_BIN to native PostgreSQL bin directory.');
const executable = (name) => path.join(bin, process.platform === 'win32' ? `${name}.exe` : name);
// pg_ctl's detached Windows server can inherit pipes. Wait on its process exit,
// not on inherited stream closure, and never open a visible console window.
const control = (argv) => new Promise((resolve,reject) => {
  const child = spawn(executable('pg_ctl'), argv, { windowsHide: true, stdio: 'ignore' });
  child.once('error',reject);
  child.once('exit',(code) => code === 0 ? resolve() : reject(new Error(`pg_ctl failed: ${code}`)));
});
const data = await fs.mkdtemp(path.join(os.tmpdir(), 'opera-agent-tx-db-'));
const socket = net.createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
let started = false;
const args = ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres'];
const query = async (sql, role = 'service_role') => {
  const result = await run(executable('psql'), [...args, '-c', `set statement_timeout='10s'; set role ${role}; ${sql}`], { windowsHide: true, maxBuffer: 1048576 });
  return result.stdout.trim();
};
const fails = async (sql, code, role) => assert.rejects(query(sql, role), (error) => error.stderr?.includes(code));
const hash = (char) => `sha256:${char.repeat(64)}`;
const nonce = (id) => `sha256:${createHash('sha256').update(id).digest('hex')}`;
const P = 'opera_agent_tx_candidate';
const actor = 'synthetic_a';
const tenant = 'tenant_a';
const create = (id, tenantId = tenant, actorId = actor) => `${P}.prepare('${tenantId}','${actorId}','${id}','${hash('a')}','${hash('b')}','${hash('c')}','device_${tenantId}',42,'oatx1.synthetic.cipher',coalesce((select prepared_at from ${P}.runs where tenant_id='${tenantId}' and transaction_id='${id}'),statement_timestamp()),coalesce((select expires_at from ${P}.runs where tenant_id='${tenantId}' and transaction_id='${id}'),statement_timestamp()+interval '10 minutes'))`;
const claim = (id, worker = 'worker_a') => `${P}.claim('${tenant}','${actor}','${id}','${worker}')`;
const stage = (id, epoch = 1) => `${P}.await_approval('${tenant}','${actor}','${id}',${epoch},'${hash('b')}','${hash('d')}')`;
const issue = (id, nonceDigest = nonce(id)) => `${P}.issue_approval('${tenant}','${actor}','${id}',1,'${hash('b')}','${nonceDigest}','${hash('e')}',120000)`;
const consume = (id, digest = 'f', nonceDigest = nonce(id)) => `${P}.consume_approval('${tenant}','${actor}','${id}',1,'${hash('b')}','${nonceDigest}','${hash('e')}','${hash(digest)}')`;
const validate = (id) => `${P}.mark_validated('${tenant}','${actor}','${id}',1,'${hash('b')}')`;
const reserve = (id) => `${P}.reserve_slot('${tenant}','${actor}','${id}',1,'${hash('b')}')`;
const prepared = async (id) => { await query(`select ${create(id)}; select ${claim(id)};`); };
const approved = async (id) => { await prepared(id); await query(`select ${stage(id)}; select ${issue(id)}; select ${consume(id)}; select ${validate(id)};`); };
const scoped = (sql, name) => sql.replaceAll('tenant_a', name);
const setupScope = async (name) => query(`insert into ${P}.principals values ('${name}','${actor}','user_a','client_a');`,'postgres');
const approveScope = async (name,id,tab,target='c') => query(scoped(`select ${create(id).replace(',42,',`,${tab},`).replace(hash('c'),hash(target))}; select ${claim(id)}; select ${stage(id)}; select ${issue(id)}; select ${consume(id)}; select ${validate(id)};`,name));
const cancelScope = (name,id) => query(`select ${P}.cancel('${name}','${actor}','${id}');`);

before(async () => {
  await run(executable('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { windowsHide: true });
  await control(['-D', data, '-l', path.join(data, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  started = true;
  await query('create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;', 'postgres');
  await run(executable('psql'), [...args, '-f', fileURLToPath(new URL('../../supabase/candidates/transaction-journal-8d.sql', import.meta.url))], { windowsHide: true });
  await query(`update ${P}.policy set mode='DARK'; insert into ${P}.principals values ('tenant_a','synthetic_a','user_a','client_a'),('tenant_b','synthetic_b','user_b','client_b');`, 'postgres');
});

after(async () => {
  if (started) await control(['-D', data, '-m', 'fast', '-w', 'stop']);
  // Keep synthetic diagnostic artifacts; never recursively delete a computed path.
  console.log(`Native PostgreSQL stopped; synthetic diagnostic directory: ${data}`);
});

test('8D private schema/RLS/function grants deny anon and authenticated', async () => {
  for (const role of ['anon', 'authenticated']) {
    await fails(`select * from ${P}.runs;`, 'permission denied', role);
    await fails(`select ${create('denied')};`, 'permission denied', role);
  }
  assert.equal(await query(`select count(*) from pg_class where relnamespace='${P}'::regnamespace and relkind='r' and not relrowsecurity;`, 'postgres'), '0');
  assert.equal(await query(`select count(*) from pg_proc where pronamespace='${P}'::regnamespace and prosecdef;`, 'postgres'), '0');
});

test('8D OFF and ENFORCED cannot grant candidate browser/agent commit authority', async () => {
  await query(`update ${P}.policy set mode='OFF';`, 'postgres');
  await fails(`select ${create('off')};`, 'TRANSACTION_DISABLED');
  await fails(`update ${P}.policy set agent_commit_enabled=true;`, 'check constraint', 'postgres');
  await fails(`update ${P}.policy set mode='ENFORCED',legacy_gated=false;`, 'check constraint', 'postgres');
  await query(`update ${P}.policy set mode='ENFORCED',legacy_gated=true;`, 'postgres');
  await fails(`select ${create('enforced')};`, 'TRANSACTION_DISABLED');
  await query(`update ${P}.policy set mode='DARK';`, 'postgres');
});

test('8D exact prepare replay is stable and altered fence collides', async () => {
  await query(`select ${create('replay')};`);
  assert.equal(await query(`select ${create('replay')}->>'replay';`), 'true');
  await fails(`select ${create('replay').replace(hash('b'), hash('9'))};`, 'IDEMPOTENCY_COLLISION');
  await fails(`select ${create('replay').replace('select expires_at','select expires_at+interval \'1s\'')};`, 'IDEMPOTENCY_COLLISION');
  assert.equal(await query(`select count(*) from ${P}.runs where transaction_id='replay';`), '1');
});

test('8D foreign tenant/principal cannot read, claim, cancel, stage or consume', async () => {
  await prepared('isolation');
  for (const sql of [
    `${P}.read_run('tenant_b','synthetic_b','isolation')`,
    `${P}.claim('tenant_b','synthetic_b','isolation','worker_b')`,
    `${P}.cancel('tenant_b','synthetic_b','isolation')`,
    stage('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
    consume('isolation').replaceAll('tenant_a','tenant_b').replaceAll('synthetic_a','synthetic_b'),
  ]) await fails(`select ${sql};`, 'TRANSACTION_NOT_FOUND');
});

test('8D lease CAS rejects rivals/stale epochs and worker death permits fenced reclaim', async () => {
  await prepared('lease');
  await fails(`select ${claim('lease','worker_b')};`, 'LEASE_BUSY');
  await query(`update ${P}.runs set lease_until=clock_timestamp()-interval '1s' where transaction_id='lease';`, 'postgres');
  assert.equal(await query(`select ${claim('lease','worker_b')}->>'leaseEpoch';`), '2');
  await fails(`select ${stage('lease',1)};`, 'STALE_LEASE');
  await query(`select ${stage('lease',2)};`);
});

test('8D journal exact redelivery advances once; changed material fails', async () => {
  await prepared('journal');
  await query(`select ${stage('journal')};`);
  assert.equal(await query(`select ${stage('journal')}->>'replay';`), 'true');
  await fails(`select ${stage('journal').replace(hash('d'),hash('8'))};`, 'IDEMPOTENCY_COLLISION');
  assert.equal(await query(`select transition from ${P}.runs where transaction_id='journal';`), '1');
});

test('8D two native DB sessions consume one nonce with one logical advancement', async () => {
  await prepared('nonce');
  await query(`select ${stage('nonce')}; select ${issue('nonce')};`);
  await fails(`select ${issue('nonce').replace('120000','119999')};`, 'IDEMPOTENCY_COLLISION');
  const results = await Promise.all([query(`select ${consume('nonce')}->>'replay';`), query(`select ${consume('nonce')}->>'replay';`)]);
  assert.deepEqual(results.sort(), ['false','true']);
  assert.equal(await query(`select transition from ${P}.runs where transaction_id='nonce';`), '2');
  await fails(`select ${consume('nonce','9')};`, 'APPROVAL_ALREADY_CONSUMED');
});

test('8D transaction rollback undoes nonce consumption and journal together', async () => {
  await prepared('rollback');
  await query(`select ${stage('rollback')}; select ${issue('rollback',hash('2'))};`);
  const operation = consume('rollback','f',hash('2'));
  await fails(`begin; select ${operation}; select 1/0; commit;`, 'division by zero');
  assert.equal(await query(`select consumed_at is null from ${P}.approvals where transaction_id='rollback';`), 't');
  assert.equal(await query(`select transition from ${P}.runs where transaction_id='rollback';`), '1');
});

test('8D reserved commit slot is deterministic, one-shot and never dispatches', async () => {
  await approved('slot');
  const result = JSON.parse(await query(`select ${reserve('slot')};`));
  assert.match(result.commitKey, /^tx1:[0-9a-f]{64}$/);
  assert.equal(result.browserDispatchAllowed, false);
  assert.equal(JSON.parse(await query(`select ${reserve('slot')};`)).replay, true);
  assert.equal(await query(`select count(*) from ${P}.commit_slots where transaction_id='slot';`), '1');
});

test('8D approval and validation clocks have strict bounds before slot reservation', async () => {
  await approved('delay');
  await query(`update ${P}.runs set validated_at=clock_timestamp()-interval '6s' where transaction_id='delay';`, 'postgres');
  await fails(`select ${reserve('delay')};`, 'VALIDATION_EXPIRED');
  await query(`select ${validate('delay')}; update ${P}.approvals set consumed_at=clock_timestamp()-interval '16s' where transaction_id='delay';`, 'postgres');
  await fails(`select ${reserve('delay')};`, 'APPROVAL_EXPIRED');
});

test('8D cancel/expiry invalidate leases and survive a new native DB session', async () => {
  await prepared('cancelled');
  await query(`select ${P}.cancel('${tenant}','${actor}','cancelled');`);
  await fails(`select ${stage('cancelled')};`, 'TRANSACTION_TERMINAL');
  assert.equal(await query(`select ${P}.read_run('${tenant}','${actor}','cancelled')->>'status';`), 'CANCELLED');
  await prepared('expired');
  await query(`update ${P}.runs set created_at=statement_timestamp()-interval '2s',prepared_at=statement_timestamp()-interval '2s',expires_at=statement_timestamp()-interval '1s' where transaction_id='expired';`, 'postgres');
  assert.equal(await query(`select ${claim('expired')}->>'status';`), 'EXPIRED');
});

test('8D pending/rate/payload quotas reject atomically without extra rows', async () => {
  for (let i=0;i<8;i++) await query(`select ${create(`quota_${i}`,'tenant_b','synthetic_b')};`);
  await fails(`select ${create('quota_8','tenant_b','synthetic_b')};`, 'PENDING_LIMIT');
  await fails(`select ${create('payload').replace("'oatx1.synthetic.cipher'", "repeat('x',196609)")};`, 'check constraint');
  await query(`update ${P}.rates set prepares=20,window_start=date_trunc('minute',clock_timestamp()) where tenant_id='tenant_a';`, 'postgres');
  await fails(`select ${create('rate')};`, 'PREPARE_RATE_LIMIT');
  assert.equal(await query(`select count(*) from ${P}.runs where transaction_id in ('quota_8','payload','rate');`), '0');
});

test('8D journal status is a closed frozen vocabulary even for privileged writes', async () => {
  await fails(`update ${P}.journal set status='PROVED_BY_PAGE';`,'check constraint','postgres');
});

test('8D competing native slots cannot bypass physical target by changing digest', async () => {
  const name='race_target'; await setupScope(name);
  await approveScope(name,'race_one',101,'c'); await approveScope(name,'race_two',101,'9');
  const results=await Promise.allSettled(['race_one','race_two'].map(id=>query(scoped(`select ${reserve(id)};`,name))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.stderr,/TARGET_COMMIT_LIMIT/);
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'1');
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'1');
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='${name}' and status='APPROVED' and transition=2;`),'1');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}' and transition=3;`),'1');
});

test('8D tenant allows two distinct targets but concurrent third contenders rollback', async () => {
  const name='race_tenant'; await setupScope(name);
  for(const [id,tab] of [['tenant_one',201],['tenant_two',202],['tenant_three',203]]) await approveScope(name,id,tab);
  await query(scoped(`select ${reserve('tenant_one')};`,name));
  const results=await Promise.allSettled(['tenant_two','tenant_three'].map(id=>query(scoped(`select ${reserve(id)};`,name))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.stderr,/COMMIT_CONCURRENCY_LIMIT/);
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'2');
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'2');
  assert.equal(await query(`select count(*) from ${P}.runs where tenant_id='${name}' and status='APPROVED' and transition=2;`),'1');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}' and transition=3;`),'2');
});

test('8D tenth commit succeeds, eleventh rolls back, exact replay does not spend rate', async () => {
  const name='rate_commit'; await setupScope(name);
  for(let i=0;i<11;i++) {
    const id=`commit_${i}`; await approveScope(name,id,300+i);
    // Pin the isolated synthetic window: this is a boundary test, not wall-clock minute timing.
    await query(`update ${P}.rates set window_start=date_trunc('minute',clock_timestamp()) where tenant_id='${name}';`,'postgres');
    if(i===10) { await fails(scoped(`select ${reserve(id)};`,name),'COMMIT_RATE_LIMIT'); break; }
    await query(scoped(`select ${reserve(id)};`,name));
    assert.equal(await query(scoped(`select ${reserve(id)}->>'replay';`,name)),'true');
    await cancelScope(name,id); // Candidate has no dispatch; release concurrent status without clearing rate/slot history.
  }
  assert.equal(await query(`select commits from ${P}.rates where tenant_id='${name}';`),'10');
  assert.equal(await query(`select count(*) from ${P}.commit_slots where tenant_id='${name}';`),'10');
  assert.equal(await query(`select status||':'||transition from ${P}.runs where tenant_id='${name}' and transaction_id='commit_10';`),'APPROVED:2');
  assert.equal(await query(`select count(*) from ${P}.journal where tenant_id='${name}' and transaction_id='commit_10' and transition=3;`),'0');
});

test('8D bounded cleanup removes eligible synthetic rows and leaves policy OFF', async () => {
  await query(`insert into ${P}.rates select 'old_rate_'||i,statement_timestamp()-interval '8 days',0,0 from generate_series(1,5) i;`, 'postgres');
  assert.equal(await query(`select ${P}.cleanup(2);`), '2');
  assert.equal(await query(`select count(*) from ${P}.rates where tenant_id like 'old_rate_%';`), '3');
  await query(`update ${P}.runs set created_at=statement_timestamp()-interval '24 hours 1 second',prepared_at=statement_timestamp()-interval '24 hours 1 second',expires_at=statement_timestamp()-interval '24 hours 1 second'+interval '10 minutes',worker_id=null,lease_until=null where transaction_id='replay';`, 'postgres');
  await query(`select ${P}.cleanup(1);`);
  assert.equal(await query(`select count(*) from ${P}.runs where transaction_id='replay';`),'0');
  await query(`update ${P}.runs set created_at=statement_timestamp()-interval '8 days',prepared_at=statement_timestamp()-interval '8 days',expires_at=statement_timestamp()-interval '8 days'+interval '10 minutes',status='EXPIRED',terminal_at=statement_timestamp()-interval '8 days',worker_id=null,lease_until=null; update ${P}.policy set mode='OFF';`, 'postgres');
  assert.equal(await query(`select ${P}.cleanup(2);`), '2');
  await query(`select ${P}.cleanup(100);`);
  assert.equal(await query(`select count(*) from ${P}.runs;`), '0');
  assert.equal(await query(`select count(*) from ${P}.approvals;`), '0');
  assert.equal(await query(`select count(*) from ${P}.journal;`), '0');
  assert.equal(await query(`select count(*) from ${P}.commit_slots;`), '0');
  assert.equal(await query(`select mode from ${P}.policy;`), 'OFF');
  await query(`delete from ${P}.rates; delete from ${P}.principals;`, 'postgres');
  assert.equal(await query(`select count(*) from ${P}.principals;`), '0');
});
