import test from 'node:test';
import assert from 'node:assert/strict';
import {mayAccessLoanPage,isLoanGateEnabled} from './staff-loan-page-policy.mjs';

test('approved staff/admin for matching Google subject may enter loan pages',()=>{
  for(const role of ['staff','admin']){
    assert.equal(mayAccessLoanPage('s1',{google_sub:'s1',status:'approved',role}),true);
  }
});
test('pending, suspended, rejected, wrong subject and invalid role are denied',()=>{
  for(const status of ['pending','suspended','rejected'])
    assert.equal(mayAccessLoanPage('s1',{google_sub:'s1',status,role:'staff'}),false);
  assert.equal(mayAccessLoanPage('s1',{google_sub:'s2',status:'approved',role:'staff'}),false);
  assert.equal(mayAccessLoanPage('s1',{google_sub:'s1',status:'approved',role:'owner'}),false);
  assert.equal(mayAccessLoanPage('',{google_sub:'s1',status:'approved',role:'staff'}),false);
  assert.equal(mayAccessLoanPage('s1',null),false);
});
test('gate is opt-in, never enabled by preview default or truthy strings',()=>{
  assert.equal(isLoanGateEnabled({}),false);
  assert.equal(isLoanGateEnabled({JIBUNDEN_STAFF_GATE_MODE:'true'}),false);
  assert.equal(isLoanGateEnabled({JIBUNDEN_STAFF_GATE_MODE:'enforce'}),true);
});
