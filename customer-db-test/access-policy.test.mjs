import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeCustomerAccess as check} from './access-policy.mjs';
const directory={
  owner:{role:'staff',active:true},other:{role:'staff',active:true},
  reader:{role:'staff',active:true},editor:{role:'staff',active:true},
  admin:{role:'admin',active:true},inactive:{role:'staff',active:false}
};
const id=sub=>({sub,verified:true,email_verified:true});
const record={id:'TEST-LOAN-20261111',ownerSub:'owner',grants:[{sub:'reader',level:'read'},{sub:'editor',level:'write'}]};
const call=(sub,action,more={})=>check({identity:id(sub),staffDirectory:directory,record,action,...more});
test('owner can read and write',()=>{assert.equal(call('owner','read').allow,true);assert.equal(call('owner','write').allow,true)});
test('admin can read and write',()=>{assert.equal(call('admin','read').allow,true);assert.equal(call('admin','write').allow,true)});
test('explicit read grant cannot write',()=>{assert.equal(call('reader','read').allow,true);assert.equal(call('reader','write').allow,false)});
test('explicit edit grant can write',()=>assert.equal(call('editor','write').allow,true));
test('other staff denied',()=>assert.equal(call('other','read').allow,false));
test('unregistered and inactive staff denied',()=>{assert.equal(call('unknown','read').allow,false);assert.equal(call('inactive','read').allow,false)});
test('unverified identity, missing sub, and unverified email denied',()=>{
 assert.equal(call('owner','read',{identity:{...id('owner'),verified:false}}).allow,false);
 assert.equal(call('owner','read',{identity:{...id('owner'),sub:''}}).allow,false);
 assert.equal(call('owner','read',{identity:{...id('owner'),email_verified:false}}).allow,false);
});
test('client-supplied email and author cannot confer privileges',()=>assert.equal(call('other','write',{identity:{...id('other'),email:'owner@example.com',author:'owner'}}).allow,false));
test('unknown action and invalid record denied',()=>{assert.equal(call('owner','delete').allow,false);assert.equal(call('owner','write',{record:{id:'x',ownerSub:''}}).allow,false)});
test('malformed grants cannot authorize',()=>assert.equal(call('other','write',{record:{id:'x',ownerSub:'owner',grants:[{sub:'other',level:'admin'}]}}).allow,false));
