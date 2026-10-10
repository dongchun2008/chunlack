'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {inflateSync} = require('node:zlib');
const {createSyntheticImage} = require('./helpers/browser-pilot-seed.cjs');

function chunks(bytes) {
  const result = []; let offset = 8;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    result.push({type, data: bytes.subarray(offset + 8, offset + 8 + size)});
    offset += size + 12;
  }
  assert.equal(offset, bytes.length);
  return result;
}

test('manual browser fixture image has complete RGB rows, not a large header around a one-pixel payload', () => {
  const bytes = createSyntheticImage(), parts = chunks(bytes), header = parts[0].data;
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(header.readUInt32BE(0), 640); assert.equal(header.readUInt32BE(4), 360);
  assert.equal(header[8], 8); assert.equal(header[9], 2);
  const rows = inflateSync(parts.find(part => part.type === 'IDAT').data), stride = 640 * 3 + 1;
  assert.equal(rows.length, 360 * stride);
  for (let y = 0; y < 360; y++) assert.equal(rows[y * stride], 0);
  assert.deepEqual([...rows.subarray(1, 4)], [112, 135, 58]);
  assert.deepEqual([...rows.subarray(121, 124)], [235, 241, 214]);
  assert.deepEqual([...rows.subarray(40 * stride + 1, 40 * stride + 4)], [235, 241, 214]);
});

test('manual browser fixture PNG is bounded, deterministic and explicitly marked synthetic in its own bytes', () => {
  const bytes = createSyntheticImage();
  assert.ok(bytes.length < 2097152);
  assert.deepEqual(bytes, createSyntheticImage());
  assert.deepEqual(chunks(bytes).map(part => part.type), ['IHDR', 'tEXt', 'IDAT', 'IEND']);
  assert.ok(bytes.includes(Buffer.from('SYNTHETIC LOCAL PNG ONLY - NOT MUSE/DOTS')));
});
