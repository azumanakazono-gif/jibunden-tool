import {createHmac,timingSafeEqual} from 'node:crypto';

export const COOKIE_NAME='jibunden_staff_preview';
const MAX_AGE=24*60*60;

export function validSessionSecret(secret) {
  return typeof secret==='string' && secret.length>=32;
}
function sign(payload,secret){
  return createHmac('sha256',secret).update(payload).digest('base64url');
}
export function issueSession(sub, secret, now=Date.now()){
  if (!validSessionSecret(secret) || typeof sub!=='string'||!/^[^\s]{1,255}$/.test(sub)) throw Error('SESSION_UNAVAILABLE');
  const payload=Buffer.from(JSON.stringify({sub,exp:Math.floor(now/1000)+MAX_AGE})).toString('base64url');
  return payload+'.'+sign(payload,secret);
}
export function readSession(token,secret,now=Date.now()){
  if (!validSessionSecret(secret) || typeof token!=='string'||token.length>2000) return null;
  const parts=token.split('.');
  if(parts.length!==2 || !parts[0] || !/^[a-zA-Z0-9_-]+$/.test(parts[1])) return null;
  const supplied=Buffer.from(parts[1],'base64url');
  const expected=Buffer.from(sign(parts[0],secret),'base64url');
  if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected))return null;
  try {
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(typeof data.sub!=='string'||!/^[^\s]{1,255}$/.test(data.sub)||
      !Number.isSafeInteger(data.exp)||data.exp<=Math.floor(now/1000)||
      data.exp>Math.floor(now/1000)+MAX_AGE) return null;
    return data.sub;
  }catch {return null;}
}
export function readCookieHeader(header){
  if(typeof header!=='string')return null;
  const part=header.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='));
  return part?part.slice(COOKIE_NAME.length+1):null;
}
export function setSessionCookie(res,token){
  res.setHeader('Set-Cookie',COOKIE_NAME+'='+token+'; Path=/; Max-Age='+MAX_AGE+'; HttpOnly; Secure; SameSite=Lax');
}
export function clearSessionCookie(res){
  res.setHeader('Set-Cookie',COOKIE_NAME+'=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
}
