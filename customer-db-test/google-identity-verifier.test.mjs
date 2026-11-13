import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStaffGoogleIdentity as verify} from './google-identity-verifier.mjs';
import {authorizeMixedAccountAccess as access} from './mixed-account-policy.mjs';

const clientId='test-preview.apps.googleusercontent.com';
const validPayload=()=>({
  iss:'https://accounts.google.com',aud:clientId,sub:'owner-personal-sub',
  email_verified:true,email:'person@gmail.com',
  exp:Math.floor(Date.now()/1000)+300
});
const client=payload=>({verifyIdToken:async({idToken,audience})=>{
  assert.equal(idToken,'test-only-placeholder');
  assert.equal(audience,clientId);
  return {getPayload:()=>payload};
}});
const check=async(payload, overrides={})=>verify({
  idToken:'test-only-placeholder',clientId,oauthClient:client(payload),...overrides
});
test('verified personal Gmail maps to approved staff account',async()=>{
  const identity=await check(validPayload());
  assert.equal(identity.sub,'owner-personal-sub');
  const decision=access({
    identity,
    accountDirectory:{'owner-personal-sub':{staffId:'employee-01',active:true}},
    staffDirectory:{'employee-01':{role:'staff',active:true}},
    record:{id:'TEST-LOAN-20261111',ownerStaffId:'employee-01'},
    action:'write'
  });
  assert.equal(decision.allow,true);
});
test('unapproved personal Gmail is not implicitly admitted',async()=>{
  const identity=await check(validPayload());
  const decision=access({
    identity,accountDirectory:{},
    staffDirectory:{},record:{id:'test',ownerStaffId:'owner'},action:'read'
  });
  assert.equal(decision.allow,false);
  assert.equal(decision.reason,'ACCOUNT_NOT_ENROLLED');
});
test('valid Workspace token can use same verifier without email domain allowlist',async()=>{
  const identity=await check({...validPayload(),sub:'company-sub',
    email:'employee@e-azuma.jp',hd:'e-azuma.jp'});
  assert.equal(identity.sub,'company-sub');
  assert.equal(identity.hostedDomain,'e-azuma.jp');
});
test('wrong audience, wrong issuer, expired, missing sub, unverified email rejected',async()=>{
  for(const patch of [{aud:'another-client'}, {iss:'attacker.example'},
    {exp:Math.floor(Date.now()/1000)-10},{sub:''},{email_verified:false}]) {
    await assert.rejects(check({...validPayload(),...patch}),/INVALID_GOOGLE_ID_TOKEN/);
  }
});
test('missing config or missing token refused',async()=>{
  await assert.rejects(check(validPayload(),{clientId:''}),/IDENTITY_VERIFICATION_UNAVAILABLE/);
  await assert.rejects(check(validPayload(),{idToken:''}),/IDENTITY_VERIFICATION_UNAVAILABLE/);
});
test('signature verification error is refused',async()=>{
  await assert.rejects(verify({
    idToken:'test-only-placeholder',clientId,
    oauthClient:{verifyIdToken:async()=>{throw Error('bad signature')}}
  }),/INVALID_GOOGLE_ID_TOKEN/);
});
