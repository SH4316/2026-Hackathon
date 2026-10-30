import test from 'node:test';
import assert from 'node:assert/strict';
import { fileReportRequest } from '../src/file-report.js';
const MiB = 1024 * 1024;
const image = (name, size) => ({ name, media_type: 'image/png', data_base64: Buffer.alloc(size, 7).toString('base64') });
test('full filename, original image bytes and send action survive the report envelope', () => {
  const name = '합성 문서 사진 전체 이름.png', raw = image(name, 42);
  const request = fileReportRequest({ inputVersion: `file:${name}`, destination: { provider: 'openai', channel: 'consumer' },
    files: [{ name }], images: [raw], sendAction: 'forced' });
  assert.deepEqual(request.files, [{ name }]); assert.deepEqual(request.images, [raw]);
  assert.equal(request.send_action, 'forced'); assert.equal(request.input_version, `file:${name}`);
  assert.equal(Buffer.from(request.images[0].data_base64, 'base64').length, 42);
});
test('5 MiB boundary and 10 MiB aggregate preserve names while omitting oversized images', () => {
  const images = [image('a.png', 5 * MiB), image('b.png', 5 * MiB), image('c.png', 1), image('large.png', 5 * MiB + 1)];
  const result = fileReportRequest({ files: images.map(({ name }) => ({ name })), images });
  assert.equal(result.files.length, 4); assert.deepEqual(result.images.map(i => i.name), ['a.png', 'b.png']);
});
test('at most 20 images, 100 names and only named image MIME payloads', () => {
  const images = Array.from({ length: 23 }, (_, i) => image(`${i}.png`, 1));
  const files = Array.from({ length: 103 }, (_, i) => ({ name: `${i}.png` }));
  const result = fileReportRequest({ files, images: [...images, { ...image('100.png', 1), media_type: 'text/plain' }] });
  assert.equal(result.images.length, 20); assert.equal(result.files.length, 100); assert.equal(result.send_action, 'normal');
  assert.equal(fileReportRequest({ files: [], images }).images.length, 0);
});
