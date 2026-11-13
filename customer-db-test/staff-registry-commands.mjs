import {evaluateStaffApproval} from './staff-approval-policy.mjs';

/**
 * Preview-only server-side staff-registry command logic.
 *
 * Storage is intentionally NOT connected. Production wiring requires a
 * durable, server-owned transactional store, an audited admin bootstrap,
 * authenticated server-side Google identity, CSRF/session controls, and
 * independent review before any HTTP endpoint is exposed.
 *
 * The store's transact(fn) contract must atomically commit both changes and
 * append-only audit records, or roll back everything on failure. A distributed
 * store must also provide serializable isolation for concurrent admin actions.
 */
const ensure=(condition,code)=>{if(!condition)throw new Error(code);};
const isSubject=(value)=>typeof value==='string' && value.length>=1 &&
  value.length<=255 && !/\s/.test(value);
const isTrustedIdentity=(identity)=>identity?.verified===true &&
  identity.email_verified===true && isSubject(identity.sub);

export async function executeStaffCommand({actor,command,store,now=()=>new Date().toISOString()}) {
  ensure(isTrustedIdentity(actor),'ACTOR_NOT_VERIFIED');
  ensure(store && typeof store.transact==='function','STORE_NOT_CONFIGURED');
  ensure(command && typeof command==='object' && !Array.isArray(command),'INVALID_COMMAND');
  ensure(['register','approve','suspend','reject'].includes(command.action),'INVALID_ACTION');
  ensure(isSubject(command.googleSub),'INVALID_TARGET');
  // Never auto-enroll or auto-approve based on email or domain.
  ensure(actor.sub!==command.googleSub,'SELF_MANAGEMENT_FORBIDDEN');

  return store.transact(async tx=>{
    ensure(tx && typeof tx.getStaff==='function' &&
      typeof tx.putStaff==='function' && typeof tx.appendAudit==='function',
      'TRANSACTION_NOT_SUPPORTED');
    const admin=await tx.getStaff(actor.sub);
    const granted=evaluateStaffApproval(actor,admin);
    ensure(granted.approved && granted.role==='admin','ADMIN_REQUIRED');
    const previous=await tx.getStaff(command.googleSub);
    const timestamp=now();
    ensure(typeof timestamp==='string' && !Number.isNaN(Date.parse(timestamp)),
      'INVALID_TIMESTAMP');
    let next;
    if(command.action==='register'){
      ensure(previous==null,'STAFF_ALREADY_REGISTERED');
      // Registration is always pending and always least-privilege.
      // Admin roles must be provisioned by a separately reviewed process.
      next={googleSub:command.googleSub,status:'pending',role:'staff',
        version:1,createdAt:timestamp,updatedAt:timestamp};
    }else{
      ensure(previous && previous.googleSub===command.googleSub,'STAFF_NOT_FOUND');
      ensure(previous.role==='staff','ADMIN_ROLE_MUTATION_FORBIDDEN');
      ensure(Number.isSafeInteger(previous.version)&&previous.version>=1,
        'STAFF_RECORD_INVALID');
      if(command.action==='approve'){
        ensure(previous.status==='pending','INVALID_STATUS_TRANSITION');
      }else if(command.action==='suspend'){
        ensure(previous.status==='approved','INVALID_STATUS_TRANSITION');
      }else{
        ensure(previous.status==='pending','INVALID_STATUS_TRANSITION');
      }
      next={...previous,status:command.action==='approve'?'approved':
        command.action==='suspend'?'suspended':'rejected',
        version:previous.version+1,updatedAt:timestamp};
    }
    await tx.putStaff(next);
    await tx.appendAudit({
      action:command.action,
      actorSub:actor.sub,
      targetSub:command.googleSub,
      fromStatus:previous?.status??null,
      toStatus:next.status,
      timestamp,
      version:next.version
    });
    return Object.freeze({googleSub:next.googleSub,status:next.status,version:next.version});
  });
}
