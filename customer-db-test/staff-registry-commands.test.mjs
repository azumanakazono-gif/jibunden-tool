import test from 'node:test';
import assert from 'node:assert/strict';
import {executeStaffCommand} from './staff-registry-commands.mjs';

// Fake transaction storage: commit changes and audit together, or roll back.
function createTestStore(initial=[]){
  const people=new Map(initial.map(x=>[x.googleSub,{...x}]));
  const audit=[];
  return {
    people,audit,
    async transact(work){
      const working=new Map([...people].map(([k,v])=>[k,{...v}]));
      const buffered=[];
      const result=await work({
        getStaff:async(sub)=>working.get(sub),
        putStaff:async(record)=>working.set(record.googleSub,{...record}),
        appendAudit:async(entry)=>buffered.push({...entry})
      });
      people.clear();for(const [k,v] of working)people.set(k,v);
      audit.push(...buffered);
      return result;
    }
  };
}
const adminIdentity={verified:true,email_verified:true,sub:'admin-sub',email:'admin@example.com'};
const staffIdentity={verified:true,email_verified:true,sub:'staff-sub'};
const admin={googleSub:'admin-sub',role:'admin',status:'approved',version:1};
const pending={googleSub:'staff-sub',role:'staff',status:'pending',version:1};
const now=()=> '2026-11-13T09:00:00.000Z';
const call=(store,action,googleSub='staff-sub',actor=adminIdentity)=>
  executeStaffCommand({store,actor,command:{action,googleSub},now});

test('only a server-approved admin can register staff, initially pending',async()=>{
  const store=createTestStore([admin]);
  assert.deepEqual(await call(store,'register'),{googleSub:'staff-sub',status:'pending',version:1});
  assert.equal(store.people.get('staff-sub').role,'staff');
  assert.equal(store.audit.length,1);
  assert.equal(store.audit[0].actorSub,'admin-sub');
  assert.equal(store.audit[0].toStatus,'pending');
});

test('a pending staff member cannot approve themselves or another user',async()=>{
  const store=createTestStore([admin,pending]);
  await assert.rejects(call(store,'approve','another-sub',staffIdentity),/ADMIN_REQUIRED/);
  assert.equal(store.audit.length,0);
});

test('self management is forbidden including privileged admins',async()=>{
  const store=createTestStore([admin]);
  await assert.rejects(call(store,'suspend','admin-sub'),/SELF_MANAGEMENT_FORBIDDEN/);
  assert.equal(store.audit.length,0);
});

test('approve, then suspend, records both changes and audit events',async()=>{
  const store=createTestStore([admin,pending]);
  await call(store,'approve');
  assert.equal(store.people.get('staff-sub').status,'approved');
  await call(store,'suspend');
  assert.equal(store.people.get('staff-sub').status,'suspended');
  assert.equal(store.people.get('staff-sub').version,3);
  assert.deepEqual(store.audit.map(x=>x.action),['approve','suspend']);
});

test('invalid transition and duplicate registration are refused',async()=>{
  const store=createTestStore([admin,pending]);
  await assert.rejects(call(store,'register'),/STAFF_ALREADY_REGISTERED/);
  await assert.rejects(call(store,'suspend'),/INVALID_STATUS_TRANSITION/);
  assert.equal(store.audit.length,0);
});

test('cannot change an admin role through staff mutation path',async()=>{
  const store=createTestStore([admin,{googleSub:'other-admin',role:'admin',status:'approved',version:1}]);
  await assert.rejects(call(store,'suspend','other-admin'),/ADMIN_ROLE_MUTATION_FORBIDDEN/);
  assert.equal(store.audit.length,0);
});

test('no authenticated admin and no configured transaction store fail closed',async()=>{
  await assert.rejects(executeStaffCommand({
    store:null,actor:adminIdentity,command:{action:'register',googleSub:'staff-sub'}
  }),/STORE_NOT_CONFIGURED/);
  await assert.rejects(call(createTestStore([admin]),'register','staff-sub',{...adminIdentity,verified:false}),
    /ACTOR_NOT_VERIFIED/);
});

test('transaction failure leaves no partial audit or state changes',async()=>{
  const store=createTestStore([admin,pending]);
  const broken={transact:async(work)=>work({
    getStaff:async(sub)=>store.people.get(sub),
    putStaff:async()=>{throw Error('STORAGE_WRITE_FAILED')},
    appendAudit:async(x)=>store.audit.push(x)
  })};
  await assert.rejects(call(broken,'approve'),/STORAGE_WRITE_FAILED/);
  assert.equal(store.people.get('staff-sub').status,'pending');
  assert.equal(store.audit.length,0);
});
