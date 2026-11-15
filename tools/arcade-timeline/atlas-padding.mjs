// Structural artwork invariant, independent of browser screenshot sampling.
// Check the complete two-pixel band around every runtime source rectangle.
export function checkAtlasPadding(catalog, images) {
  const counts = { frames: 0, paddingPixels: 0, inBoundsPixels: 0, nontransparentPixels: 0, outOfBoundsPixels: 0 };
  const failures = [], errors = [];
  const frames = Object.entries(catalog ?? {});
  if (!frames.length) errors.push('Catalog contains no runtime frames');
  for (const [name, frame] of frames) {
    counts.frames++;
    const render = frame?.render, image = images.get(render?.asset);
    if (!render || !image || ![frame.width, frame.height, image.width, image.height].every(n => Number.isSafeInteger(n) && n > 0)
      || ![render.x, render.y].every(Number.isSafeInteger) || image.data?.length !== image.width * image.height * 4
      || render.sheetWidth !== image.width || render.sheetHeight !== image.height) {
      errors.push(`${name}: missing or invalid runtime rectangle, image data, or sheet dimensions`);
      continue;
    }
    const failure = { frame: name, asset: render.asset, rectangle: { x: render.x, y: render.y, width: frame.width, height: frame.height }, nontransparentPixels: 0, outOfBoundsPixels: 0 };
    for (let y = render.y - 2; y < render.y + frame.height + 2; y++) {
      for (let x = render.x - 2; x < render.x + frame.width + 2; x++) {
        if (x >= render.x && x < render.x + frame.width && y >= render.y && y < render.y + frame.height) continue;
        counts.paddingPixels++;
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
          counts.outOfBoundsPixels++; failure.outOfBoundsPixels++;
          failure.firstOutOfBounds ??= { x, y };
        } else {
          counts.inBoundsPixels++;
          const alpha = image.data[(y * image.width + x) * 4 + 3];
          if (alpha !== 0) {
            counts.nontransparentPixels++; failure.nontransparentPixels++;
            failure.firstNontransparent ??= { x, y, alpha };
          }
        }
      }
    }
    if (failure.nontransparentPixels || failure.outOfBoundsPixels) failures.push(failure);
  }
  const status = errors.length ? 'incomplete' : failures.length ? 'fail' : 'pass';
  return { target: 'structural-atlas-padding', category: 'STRUCTURAL/ARTWORK', status,
    ...(status === 'fail' ? { failureCode: 'structural-atlas-padding-violation' } : {}),
    padding: 2, counts, failures, errors,
    scope: 'All catalog runtime rectangles require a full in-bounds transparent two-pixel band. This is a source-artwork invariant, not observed screenshot bleed.' };
}
