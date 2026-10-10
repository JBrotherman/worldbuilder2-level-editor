// Fixes for things the original WorldBuilder 2 can't do, applied to every
// build.
'use strict';
const ab = require('./afterburner');
const cast = require('./cast');
const { libraryWriter, libIndexOf, renameCast } = require('./castedit');

// While you place a building, the game draws a ghost of it using the member
// "<class>.<type>" (falling back to "<class>.<type>.right"). The windmill
// only has its animation frames ("building.windmill.1".."4"), so selecting a
// windmill plan caused a script error. Add "building.windmill" as a copy of
// the first frame; a built windmill still animates through its frames.
function addWindmillPicture(movie) {
  const byName = new Map([...cast.members(movie).values()].map((m) => [m.name, m]));
  if (byName.has('building.windmill')) return [];
  const frame = byName.get('building.windmill.1');
  const bitd = frame && frame.children.find((c) => c.tag === 'BITD');
  if (!bitd) return [];
  const lib = libraryWriter(movie, libIndexOf(movie, 'building.windmill.1'));
  lib.add(renameCast(ab.chunkData(movie, movie.byId.get(frame.id)), 'building.windmill'),
    [{ tag: 'BITD', data: ab.chunkData(movie, movie.byId.get(bitd.id)) }]);
  lib.commit();
  return ['building.windmill'];
}

function applyFixes(movie) {
  return [...addWindmillPicture(movie)];
}

module.exports = { applyFixes };
