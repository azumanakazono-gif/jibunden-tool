import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeMixedAccountAccess as authorize} from './mixed-account-policy.mjs';

const accounts = {
  'google-personal-owner':{staffId:'staff-01',active:true},
  'google-workspace-owner':{staffId:'staff-01',active:true},
  'google-other':{staffId:'staff-02',active:true},
  'google-reader':{staffId:'staff-03',active:true},
  'google-admin':{staffId:'staff-admin',active:true},
  'google-disabled':{staffId:'staff-01',active:false},
  'google-leaver':{staffId:'staff-leaver',active:true}
};
const staff = {
  'staff-01':{active:true,role:'staff'}, 'staff-02':{active:true,role:'staff'},
  'staff-03':{active:true,role:'staff'}, 'staff-admin':{active:true,role:'admin'},
  'staff-leaver':{active:false,role:'staff'}
};
const record={id:'TEST-LOAN-20261111',ownerStaffId:'staff-01',
  grants:[{staffId:'staff-03',level:'read'}]};
const identity = sub => ({sub,verified:true,email_verified:true});
const check = (sub,action,extra={}) => authorize({
  identity:identity(sub),accountDirectory:accounts,staffDirectory:staff,
  record,action,...extra
});

test('linked personal and company accounts are same staff after explicit enrollment',()=>{
  assert.equal(check('google-personal-owner','write').allow,true);
  assert.equal(check('google-workspace-owner','write').allow,true);
});
test('unregistered Google account is denied regardless of matching email',()=>{
  assert.equal(check('google-unknown','read',{
    identity:{...identity('google-unknown'),email:'owner@gmail.com'}}).reason,
    'ACCOUNT_NOT_ENROLLED');
});
test('other staff cannot impersonate owner using author or email',()=>{
  assert.equal(check('google-other','write',{
    identity:{...identity('google-other'),email:'owner@gmail.com',author:'staff-01'}}).allow,false);
});
test('explicit read grant does not allow writes',()=>{
  assert.equal(check('google-reader','read').allow,true);
  assert.equal(check('google-reader','write').allow,false);
});
test('active admin can write, disabled user and leaver cannot',()=>{
  assert.equal(check('google-admin','write').allow,true);
  assert.equal(check('google-disabled','read').allow,false);
  assert.equal(check('google-leaver','read').allow,false);
});
test('invalid token identity and unsupported operation denied',()=>{
  assert.equal(check('google-personal-owner','read',{
    identity:{...identity('google-personal-owner'),verified:false}}).allow,false);
  assert.equal(check('google-personal-owner','read',{
    identity:{...identity('google-personal-owner'),email_verified:false}}).allow,false);
  assert.equal(check('google-personal-owner','delete').allow,false);
});
test('missing or malformed record denies even admins',()=>{
  assert.equal(check('google-admin','read',{record:{id:'test',ownerStaffId:''}}).allow,false);
});
test('other staff remains denied even if arbitrary grant is malformed',()=>{
  assert.equal(check('google-other','read',{record:{
    id:'x',ownerStaffId:'staff-01',grants:[{staffId:'staff-02',level:'admin'}]}}).allow,false);
});
