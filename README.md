# WorldBuilder 2 Level Editor

A browser-based level editor for LEGO WorldBuilder 2 (the Shockwave game in
`WorldBuilder2/`). Build a level, press **Play in game**, and it launches in the
real game.

## Running it

Double-click **`Start Editor.bat`** (needs [Node.js](https://nodejs.org)). It
starts a small local server and opens the editor at <http://localhost:4321/>.
Keep the black window open while you edit. Closing it stops the editor.

## Using the editor

- **Palette (left):** terrain, vehicles & robots, buildings, monsters, brick
  piles, plans, goals and whirlpools. Click one, then click or drag on the map.
- **Tools:** Select (V or Esc) to inspect and edit tiles without changing the
  map, Paint (P), Erase items (E, or right-click while painting), Pick from
  map (I), and Start view (C) to choose where the camera starts. Each tool has
  its own cursor; the paint cursor shows a small picture of the brush.
- **Inspector (right):** level title, map size, starting plans, and the
  settings of the selected tile (pile contents, plan uses, goal target…).
- **Problems:** live checks such as a missing goal, unknown types, a goal the
  player can't reach, or a level too big for the game file. Click one to jump
  to the tile.
- **Open:** your saved levels, or a copy of any original mission to remix.
- **Save** writes `levels/<name>.txt` in the game's own level format.
- **Play in game** builds a patched copy of the game in `build/worldbuilder2/`
  with your level as **mission 1** of the jungle world, then starts it. Close
  the game before pressing Play again.

Units and plans placed on water automatically use their water version.

## Bigger game window

The game itself is fixed at 610×440. **Play in game** (and **`Play WorldBuilder
2.bat`**, which runs the original game) opens it through `WB2Window.exe`
instead: a resizable window that scales the game up while keeping its shape.
Press **F11** for fullscreen. It's compiled automatically from
`tools/window/WB2Window.cs` with the C# compiler built into Windows.

How it works: the window shows a live, GPU-scaled DWM thumbnail of the game.
The real game window is made invisible and kept just above it, and on every
mouse move it's shifted so the game pixel matching your cursor sits exactly
under the cursor. Clicks, hovering and the game's cursors work as normal, with
no faked input.

## How it works

The game is an Adobe Director movie (`worldbuilder2.dcr`, Afterburner
compressed). Levels are plain-text cast members (`map1.1` … `map2.12`), and
`Launcher.exe` is a Director projector with its own embedded copy of the movie.

| File | Purpose |
| --- | --- |
| `tools/afterburner.js` | Read/write Afterburner `.dcr` files |
| `tools/xmed.js` | Read/replace text in Director 8 text members |
| `tools/cast.js` | Cast member names and chunk links |
| `tools/bitmap.js`, `tools/sprites.js`, `tools/palettes.js` | Decode game bitmaps to PNG |
| `tools/game.js` | Load the game, patch levels, write a playable build |
| `tools/catalog.js` | Units, recipes and terrain from the game's config |
| `tools/server.js` | Editor server and API |
| `tools/extract.js` | Dump all game text (levels, config) to `extracted/` |
| `editor/` | The editor (plain HTML/JS, no build step) |

The original game files are never modified. `WorldBuilder2/`, `build/` and
`extracted/` are git-ignored (LEGO's assets, and they can be regenerated).

## Level format quick reference

```
[map]
name=MY LEVEL
 map=wwwwww          one character per tile (terrain or an item key)
 map=w.a.1w
center=3,2           optional start view (1-based column,row)

[mapitems]
a=unit,vehicle,dirtbuggy        unit / waterunit , vehicle|monster|building , type
b=pile,yellow,10,energy,1       pile / waterpile , colour,count,...
c=plan,duck,5                   plan / waterplan , type , uses
1=goal,duck                     goal|bonusgoal , type|anything|collect 1 lion [,water]
d=whirlpool,1

[inventory]
dirtbuggy=2                     plans the player starts with
```
