import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAtlasPadding } from './atlas-padding.mjs';

const fixture = () => ({
  catalog: { actor: { width: 2, height: 2, render: { asset: 'sheet.png', x: 2, y: 2, sheetWidth: 6, sheetHeight: 6 } } },
  images: new Map([['sheet.png', { width: 6, height: 6, data: Buffer.alloc(6 * 6 * 4) }]]),
});
const check = ({catalog, images}) => checkAtlasPadding(catalog, images);
test('full two-pixel transparent band passes even with opaque interior artwork', () => {
  const input = fixture(); input.images.get('sheet.png').data[(2 * 6 + 2) * 4 + 3] = 255;
  const result = check(input);
  assert.equal(result.status, 'pass');
  assert.equal(result.category, 'STRUCTURAL/ARTWORK');
  assert.deepEqual(result.counts, { frames: 1, paddingPixels: 32, inBoundsPixels: 32, nontransparentPixels: 0, outOfBoundsPixels: 0 });
  assert.deepEqual(result.failures, []);
});
test('missing second padding column is a structural failure even if remaining pixels are transparent', () => {
  const input = fixture(); input.catalog.actor.render.x = 1;
  const result = check(input);
  assert.equal(result.status, 'fail');
  assert.equal(result.counts.outOfBoundsPixels, 6);
  assert.equal(result.failureCode, 'structural-atlas-padding-violation');
  assert.deepEqual(result.failures[0].firstOutOfBounds, { x: -1, y: 0 });
});
test('neighbor pixel in the outer corner of the second padding band fails with its location and alpha', () => {
  const input = fixture(); input.images.get('sheet.png').data[(5 * 6 + 5) * 4 + 3] = 1;
  const result = check(input);
  assert.equal(result.status, 'fail');
  assert.equal(result.counts.nontransparentPixels, 1);
  assert.deepEqual(result.failures[0].firstNontransparent, { x: 5, y: 5, alpha: 1 });
});
test('out-of-bounds padding on every sheet edge is counted rather than skipped', () => {
  const input = fixture(); input.catalog.actor.width = 6; input.catalog.actor.height = 6;
  input.catalog.actor.render.x = 0; input.catalog.actor.render.y = 0;
  const result = check(input);
  assert.equal(result.status, 'fail');
  assert.equal(result.counts.paddingPixels, 64);
  assert.equal(result.counts.outOfBoundsPixels, 64);
});
test('every runtime frame is inspected, including an otherwise healthy frame after a failure', () => {
  const input = fixture(); input.catalog.bad = {...input.catalog.actor, render:{...input.catalog.actor.render,x:1}};
  input.catalog.last = {...input.catalog.actor};
  const result = check(input);
  assert.equal(result.counts.frames, 3);
  assert.equal(result.counts.paddingPixels, 96);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].frame, 'bad');
});
test('missing assets, runtime rectangles, mismatched dimensions and empty catalogs are incomplete, never detection', () => {
  for (const edit of [i=>i.images.clear(), i=>delete i.catalog.actor.render, i=>i.catalog.actor.render.sheetWidth=7, i=>i.catalog={}]) {
    const input = fixture(); edit(input); const result = check(input);
    assert.equal(result.status, 'incomplete'); assert.ok(result.errors.length); assert.equal(result.failureCode, undefined);
  }
});
