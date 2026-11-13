/**
 * PostgreSQL staff-registry adapter for isolated PREVIEW use only.
 *
 * No HTTP endpoint, credentials, session issuance or DB connection is created.
 * A trusted server-side caller must provide a dedicated PostgreSQL Pool.
 *
 * Expected schema: ./staff-registry-postgres.preview.sql
 * Runtime login must have only the narrow permissions documented there.
 */
const toStaff = (row) => !row ? null : ({
  googleSub: row.google_sub,
  status: row.status,
  role: row.role,
  version: Number(row.version),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString()
});

function assertRecord(record) {
  if (!record || typeof record.googleSub !== 'string' ||
      !['pending','approved','suspended','rejected'].includes(record.status) ||
      !['staff','admin'].includes(record.role) ||
      !Number.isSafeInteger(record.version) || record.version < 1 ||
      !Number.isFinite(Date.parse(record.createdAt)) ||
      !Number.isFinite(Date.parse(record.updatedAt))) {
    throw new Error('STAFF_RECORD_INVALID');
  }
}

export function createPostgresStaffStore(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('PG_POOL_REQUIRED');
  }
  return Object.freeze({
    async transact(work) {
      if (typeof work !== 'function') throw new Error('TRANSACTION_REQUIRED');
      const client = await pool.connect();
      let started = false;
      try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        started = true;
        const seen = new Map();
        const tx = Object.freeze({
          async getStaff(googleSub) {
            if (typeof googleSub !== 'string' || !googleSub.trim()) {
              throw new Error('STAFF_SUB_REQUIRED');
            }
            const result = await client.query(
              'SELECT google_sub, status, role, version, created_at, updated_at FROM staff_registry WHERE google_sub = $1 FOR UPDATE',
              [googleSub]
            );
            const row = result.rows[0];
            const entry = toStaff(row);
            seen.set(googleSub, entry);
            return entry;
          },
          async putStaff(record) {
            assertRecord(record);
            if (!seen.has(record.googleSub)) {
              throw new Error('STAFF_READ_BEFORE_WRITE_REQUIRED');
            }
            const before = seen.get(record.googleSub);
            if (before === null) {
              if (record.version !== 1 || record.status !== 'pending' || record.role !== 'staff') {
                throw new Error('INVALID_REGISTRATION');
              }
              await client.query(
                'INSERT INTO staff_registry (google_sub, status, role, version, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)',
                [record.googleSub,record.status,record.role,record.version,record.createdAt,record.updatedAt]
              );
              return;
            }
            if (!before || before.googleSub !== record.googleSub ||
                record.version !== before.version + 1 ||
                record.role !== before.role ||
                record.createdAt !== before.createdAt) {
              throw new Error('INVALID_STAFF_UPDATE');
            }
            const result = await client.query(
              'UPDATE staff_registry SET status=$2, version=$3, updated_at=$4 WHERE google_sub=$1 AND version=$5',
              [record.googleSub,record.status,record.version,record.updatedAt,before.version]
            );
            if (result.rowCount !== 1) throw new Error('STAFF_CONCURRENT_UPDATE');
          },
          async appendAudit(event) {
            if (!event || !['register','approve','suspend','reject'].includes(event.action) ||
                typeof event.actorSub !== 'string' ||
                typeof event.targetSub !== 'string' ||
                !Number.isSafeInteger(event.version)) {
              throw new Error('INVALID_AUDIT_EVENT');
            }
            await client.query(
              'INSERT INTO staff_audit_log (at, actor_sub, target_sub, action, from_status, to_status, record_version) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [event.timestamp,event.actorSub,event.targetSub,event.action,event.fromStatus,event.toStatus,event.version]
            );
          }
        });
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        if (started) {
          try { await client.query('ROLLBACK'); } catch { /* Preserve original failure */ }
        }
        throw error;
      } finally {
        client.release();
      }
    }
  });
}
