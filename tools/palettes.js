// Director's built-in "System - Win" palette (cast palette id -101), used by
// bitmaps that don't have a palette of their own.
//
// Director numbers palettes from white (0) to black (255), and this one is
// put together from two standard palettes:
// - the 20 colours Windows reserves in every 256-colour palette, at both
//   ends, in reverse order;
// - in between, the classic Macintosh system palette (the 6x6x6 colour cube
//   from white to black, then ramps of red, green, blue and grey; the same
//   table Director's own Launcher.exe carries), with a few colours moved.
'use strict';

// Windows' reserved colours 0-9 and 246-255.
const WIN_LOW = [[0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0], [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192], [192, 220, 192], [166, 200, 240]];
const WIN_HIGH = [[255, 251, 240], [160, 160, 164], [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0], [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255]];

// The Mac system palette: index 0 white ... 214 dark blue, 215-254 ramps,
// 255 black.
function macPalette() {
  const steps = [255, 204, 153, 102, 51, 0];
  const ramp = [238, 221, 187, 170, 136, 119, 85, 68, 34, 17];
  const pal = [];
  for (const r of steps) for (const g of steps) for (const b of steps) if (r || g || b) pal.push([r, g, b]);
  for (const v of ramp) pal.push([v, 0, 0]);
  for (const v of ramp) pal.push([0, v, 0]);
  for (const v of ramp) pal.push([0, 0, v]);
  for (const v of ramp) pal.push([v, v, v]);
  pal.push([0, 0, 0]);
  return pal;
}

function systemWinPalette() {
  const mac = macPalette();
  // Mac colours moved up to just after the Windows colours. Each leaves a
  // slightly different colour in its old place, so none appears twice.
  const moved = new Map([[172, [51, 51, 59]], [95, [161, 102, 0]], [166, [51, 110, 51]], [206, [0, 51, 161]], [66, [212, 8, 255]], [219, [144, 0, 0]]]);
  // Mac colours left out of the run below: those Windows already reserves,
  // and the 187 steps of the red, green and blue ramps.
  const skipped = new Set([30, 35, 180, 185, 210, 217, 227, 237]);
  const run = [];
  for (let i = 17; i <= 244; i++) if (!skipped.has(i)) run.push(moved.get(i) || mac[i]);
  return [
    ...WIN_HIGH.slice().reverse(),
    ...[...moved.keys(), 9, 13, 246].map((i) => mac[i]),
    ...run,
    [34, 34, 48], mac[14], mac[6], [153, 212, 255], [153, 212, 153], mac[2], [240, 240, 240],
    ...WIN_LOW.slice().reverse(),
  ];
}

module.exports = { systemWin: systemWinPalette() };
