import test from 'node:test';
import assert from 'node:assert/strict';
import {issueSession,readSession,validSessionSecret,readCookieHeader} from './staff-session-preview.mjs';
const secret='a'.repeat(48);
test('signed session permits same Google subject before expiry',()=>{
  const now=Date.parse('2026-11-15T04:00:00Z');
  const token=issueSession('google-sub-123',secret,now);
  assert.equal(readSession(token,secret,now+1000),'google-sub-123');
  assert.equal(readCookieHeader('a=b; jibunden_staff_preview='+token+'; z=x'),token);
});
test('tampered, expired, and wrong-secret sessions are denied',()=>{
  const now=Date.parse('2026-11-15T04:00:00Z');
  const token=issueSession('google-sub-123',secret,now);
  assert.equal(readSession(token,secret,now+25*60*60*1000),null);
  assert.equal(readSession(token,'b'.repeat(48),now),null);
  assert.equal(readSession(token.slice(0,-2)+'xy',secret,now),null);
  assert.equal(readSession(null,secret,now),null);
  assert.equal(validSessionSecret('short'),false);
});
