'use strict';
const {randomBytes, scrypt, timingSafeEqual} = require('node:crypto');
const {promisify} = require('node:util');
const {IdentityError} = require('./policy.cjs');
const derive = promisify(scrypt);
const options = Object.freeze({N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024});
const encodedPattern = /^scrypt\$1\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/;
const dummyHash = 'scrypt$1$32768$8$3$' + '0'.repeat(32) + '$' + '0'.repeat(64);

function validInput(password, minimum = 0) {
  return typeof password === 'string' && password.length <= 256 &&
    Array.from(password).length >= minimum && Array.from(password).length <= 128 &&
    Buffer.byteLength(password, 'utf8') <= 512 && Buffer.from(password, 'utf8').toString('utf8') === password;
}
async function hashPassword(password) {
  if (!validInput(password, 15)) throw new IdentityError('invalid_password', 400);
  const salt = randomBytes(16);
  const key = await derive(password, salt, 32, options);
  return 'scrypt$1$32768$8$3$' + salt.toString('hex') + '$' + key.toString('hex');
}
async function verifyPassword(password, encoded) {
  if (!validInput(password) || typeof encoded !== 'string' || encoded.length > 256) return false;
  const match = encodedPattern.exec(encoded);
  if (!match) return false;
  const key = await derive(password, Buffer.from(match[1], 'hex'), 32, options);
  return timingSafeEqual(key, Buffer.from(match[2], 'hex'));
}
function isPasswordHash(encoded) {
  return typeof encoded === 'string' && encoded.length <= 256 && encodedPattern.test(encoded);
}
module.exports = {hashPassword, verifyPassword, isPasswordHash, validInput, dummyHash};
