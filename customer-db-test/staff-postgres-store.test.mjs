import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresStaffStore} from './staff-postgres-store.mjs';
import {executeStaffCommand} from './staff-registry-commands.mjs';

const timestamp='2026-11-13T09:00:00.000Z';
const seedAdmin={google_sub:'admin-sub',status:'approved',role:'admin',
  version:1,created_at:timestamp,updated_at:timestamp};
const actor={verified:true,email_verified:true,sub:'admin-sub'};

function mockPostgres({initial=[seedAdmin],failAudit=false}={}) {
  const committed=new Map(initial.map(r=>[r.google_sub,{...r}]));
  const audit=[];
  const statements=[];
  let releases=0;
  const pool={async connect(){
    let pending=null, newAudit=[];
    return {
      async query(sql,args=[]) {
        statements.push(sql);
        if(sql.startsWith('BEGIN')) {
          pending=new Map([...committed].map(([k,v])=>[k,{...v}]));
          return {rows:[],rowCount:0};
        }
        if(sql==='COMMIT') {
          committed.clear();for(const [k,v] of pending)committed.set(k,v);
          audit.push(...newAudit);pending=null;return {rows:[],rowCount:0};
        }
        if(sql==='ROLLBACK') {pending=null;newAudit=[];return {rows:[],rowCount:0};}
        if(!pending) throw new Error('NO_TRANSACTION');
        if(sql.startsWith('SELECT')) {
          const row=pending.get(args[0]);return {rows:row?[row]:[],rowCount:row?1:0};
        }
        if(sql.startsWith('INSERT INTO staff_registry')) {
          if(pending.has(args[0])) throw new Error('DUPLICATE_STAFF');
          pending.set(args[0],{google_sub:args[0],status:args[1],role:args[2],
            version:args[3],created_at:args[4],updated_at:args[5]});
          return {rows:[],rowCount:1};
        }
        if(sql.startsWith('UPDATE staff_registry')) {
          const row=pending.get(args[0]);
          if(!row || row.version!==args[4])return {rows:[],rowCount:0};
          pending.set(args[0],{...row,status:args[1],version:args[2],
            updated_at:args[3]});return {rows:[],rowCount:1};
        }
        if(sql.startsWith('INSERT INTO staff_audit_log')) {
          if(failAudit)throw new Error('AUDIT_WRITE_FAILED');
          newAudit.push(args);return {rows:[],rowCount:1};
        }
        throw new Error('UNEXPECTED_SQL');
      },
      release(){releases++;}
    };
  }};
  return {pool,committed,audit,statements,get releases(){return releases;}};
}
const perform=(mock,action,target='staff-sub')=>executeStaffCommand({
  actor,command:{action,googleSub:target},store:createPostgresStaffStore(mock.pool),
  now:()=>timestamp
});

test('missing staff record is null, register is pending and audit committed atomically',async()=>{
  const mock=mockPostgres();
  assert.deepEqual(await perform(mock,'register'),
    {googleSub:'staff-sub',status:'pending',version:1});
  assert.equal(mock.committed.get('staff-sub').status,'pending');
  assert.equal(mock.audit.length,1);
  assert.ok(mock.statements.includes('BEGIN ISOLATION LEVEL SERIALIZABLE'));
  assert.ok(mock.statements.includes('COMMIT'));
  assert.equal(mock.releases,1);
});

test('approve and suspend use version-guarded transactions',async()=>{
  const mock=mockPostgres();
  await perform(mock,'register');
  await perform(mock,'approve');
  await perform(mock,'suspend');
  assert.equal(mock.committed.get('staff-sub').status,'suspended');
  assert.equal(mock.committed.get('staff-sub').version,3);
  assert.equal(mock.audit.length,3);
  assert.ok(mock.statements.some(sql=>sql.includes('AND version=$5')));
  assert.equal(mock.releases,3);
});

test('audit write failure rolls back staff record changes',async()=>{
  const pending={google_sub:'staff-sub',status:'pending',role:'staff',
    version:1,created_at:timestamp,updated_at:timestamp};
  const mock=mockPostgres({initial:[seedAdmin,pending],failAudit:true});
  await assert.rejects(perform(mock,'approve'),/AUDIT_WRITE_FAILED/);
  assert.equal(mock.committed.get('staff-sub').status,'pending');
  assert.equal(mock.committed.get('staff-sub').version,1);
  assert.equal(mock.audit.length,0);
  assert.ok(mock.statements.includes('ROLLBACK'));
  assert.equal(mock.releases,1);
});

test('non-admin identities cannot change registry or audit log',async()=>{
  const mock=mockPostgres();
  await assert.rejects(executeStaffCommand({
    actor:{verified:true,email_verified:true,sub:'unknown-sub'},
    command:{action:'register',googleSub:'staff-sub'},
    store:createPostgresStaffStore(mock.pool)
  }),/ADMIN_REQUIRED/);
  assert.equal(mock.committed.has('staff-sub'),false);
  assert.equal(mock.audit.length,0);
  assert.ok(mock.statements.includes('ROLLBACK'));
});

test('cannot use adapter without a transaction-capable pool',()=>{
  assert.throws(()=>createPostgresStaffStore(null),/PG_POOL_REQUIRED/);
  assert.throws(()=>createPostgresStaffStore({query(){}}),/PG_POOL_REQUIRED/);
});
