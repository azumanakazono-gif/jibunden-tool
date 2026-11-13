import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStaffApproval} from './staff-approval-policy.mjs';

const identity=Object.freeze({verified:true,sub:'google-sub-123',email_verified:true,email:'staff@example.com'});
const record=(status,role='staff')=>({googleSub:'google-sub-123',status,role});

test('never approves an unverified identity',()=>{
  assert.deepEqual(evaluateStaffApproval({verified:false,sub:'google-sub-123',email_verified:true},record('approved')),
    {approved:false,role:null,reason:'IDENTITY_NOT_VERIFIED'});
});

test('unregistered identities fail closed',()=>{
  assert.deepEqual(evaluateStaffApproval(identity,null),
    {approved:false,role:null,reason:'STAFF_NOT_REGISTERED'});
});

test('email matching cannot substitute for immutable sub',()=>{
  assert.deepEqual(evaluateStaffApproval(identity,{googleSub:'different-sub',email:'staff@example.com',status:'approved',role:'admin'}),
    {approved:false,role:null,reason:'STAFF_RECORD_INVALID'});
});

test('pending, suspended and rejected users are denied',()=>{
  for(const status of ['pending','suspended','rejected']){
    assert.equal(evaluateStaffApproval(identity,record(status)).approved,false);
  }
});

test('invalid role and status fail closed',()=>{
  assert.equal(evaluateStaffApproval(identity,record('approved','superadmin')).approved,false);
  assert.equal(evaluateStaffApproval(identity,record('automatic')).approved,false);
});

test('approved status yields decision only, not a login session',()=>{
  assert.deepEqual(evaluateStaffApproval(identity,record('approved','staff')),
    {approved:true,role:'staff',reason:'APPROVED'});
  assert.deepEqual(evaluateStaffApproval(identity,record('approved','admin')),
    {approved:true,role:'admin',reason:'APPROVED'});
});
