'use strict';
const {createHash} = require('node:crypto');
const {IdentityError} = require('./policy.cjs');

function createAdmission({now = Date.now, maxEntries = 2048} = {}) {
  if (typeof now !== 'function' || !Number.isInteger(maxEntries) || maxEntries < 2 || maxEntries > 2048) {
    throw new IdentityError('invalid_limits', 400);
  }
  const buckets = new Map();
  let active = false, global = null;
  const digest = value => createHash('sha256').update(value).digest('hex');
  function limited() {
    const error = new IdentityError('rate_limited', 429);
    error.retryable = true;
    error.retryAfter = 60;
    throw error;
  }
  return Object.freeze({
    enter({source, login}) {
      if (typeof source !== 'string' || !source || source.length > 256 ||
          typeof login !== 'string' || !login.trim() || login.length > 256) {
        throw new IdentityError('invalid_source', 400);
      }
      const time = now();
      if (!Number.isSafeInteger(time) || time < 0) throw new IdentityError('invalid_clock', 500);
      if (active) limited();
      for (const [key, value] of buckets) if (value.expiresAt <= time) buckets.delete(key);
      if (!global || global.expiresAt <= time) global = {count: 0, expiresAt: time + 60000};
      const keys = ['source:' + digest(source), 'login:' + digest(login.trim().toLowerCase())];
      const missing = keys.filter(key => !buckets.has(key)).length;
      if (global.count >= 30 || buckets.size + missing > maxEntries ||
          keys.some(key => (buckets.get(key)?.count || 0) >= 5)) limited();
      for (const key of keys) {
        const bucket = buckets.get(key) || {count: 0, expiresAt: time + 60000};
        bucket.count++;
        buckets.set(key, bucket);
      }
      global.count++;
      active = true;
      let released = false;
      return () => {if (!released) {released = true; active = false;}};
    }
  });
}
module.exports = {createAdmission};
