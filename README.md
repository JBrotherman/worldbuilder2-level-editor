# WorldBuilder 2 Level Editor

A browser-based level editor for LEGO WorldBuilder 2 (the Shockwave game).
Build a level, press **Play in game**, and it launches in the real game. It
comes with two 12-mission campaigns: Brickwood Valley and Brickton City.

**Use it online:** <https://jbrotherman.github.io/worldbuilder2-level-editor/>
opens the gallery of levels and campaigns players made; the **Editor** tab
(`editor.html`) is the editor. Nothing to install: show it your WorldBuilder 2
folder (or its zip) once, and everything runs in your browser (the game files
stay on your computer). To play, it gives you a ready-to-play copy of the
game, saved next to your WorldBuilder2 folder or as a zip. Your levels are
kept in that browser, so use Share for backups.

Or run it on your own PC, as below: that version starts the game for you, in
a resizable window.

## Getting started

**You need:**

- **Windows** (the game itself is a Windows program).
- **[Node.js](https://nodejs.org/)**: download the "LTS" version and install
  it with the default options.
- **Your own copy of LEGO WorldBuilder 2.** The game is LEGO's and is *not*
  included with the editor; the editor reads its pictures, levels and rules
  from your copy, and never changes it.
- *Optional:* the original **LEGO WorldBuilder** (1), for the scorpion and
  T-Rex animations and its 60 missions as templates.

**Where to put the game:** copy your `WorldBuilder2` folder into the editor's
folder, next to `Start Editor.bat`:

```
WB2-Level-Editor/
  Start Editor.bat
  Play WorldBuilder 2.bat
  WorldBuilder2/
    worldbuilder2/
      worldbuilder2.dcr
      Launcher.exe
  WorldBuilder/               (optional, the original WorldBuilder)
    worldbuilder/
      worldbuilder.dcr
```

Or leave the games where they are and tell the editor: the first time it can't
find WorldBuilder 2, its page asks for the folder. It saves that in
`settings.json` next to the .bat files, which you can also write yourself
(either the outer folder or the inner one that holds the `.dcr` works):

```json
{
  "worldBuilder2": "D:/Games/WorldBuilder2",
  "worldBuilder1": "D:/Games/WorldBuilder"
}
```

**Start it:** double-click **`Start Editor.bat`**. It starts a small local
server and opens the editor at <http://localhost:4321/>. Keep the black window
open while you edit; closing it stops the editor. **`Play WorldBuilder
2.bat`** plays the unmodified game in a resizable window.

**Share a level:** **Share** puts it in the online gallery, or gives a share
code (`WB2:…`) to paste in a chat or forum, or a level file to download. The
other player clicks **Open**, then **Paste a code or open a file…**.

**Share a campaign:** in the **Campaign** tab, **Share** puts it in the
gallery, or **Download file** saves one `.wb2campaign.json` file with the mission setup, every level it uses and your
unit settings. The other player opens it with **Import** in their Campaign tab
and presses **Play campaign**.

Everyone needs their own copy of the game; only levels and campaigns are
shared.

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

- **Share:** puts the level in the online gallery, or gives a share code
  (`WB2:…`) to send to someone, or a level file to download. **Open** has
  **Paste a code or open a file…** for levels someone sent you.

## Campaign tab

Choose a level for each of the 24 missions (keep the original, or leave it
**Not used**), give it a title, and click the numbers to choose which missions
it unlocks when completed. Unused missions stay locked, and the game doesn't
show locked missions on the world map, so a campaign can have any number of
missions. **New** starts a campaign with every mission unused; choosing a
level for the next mission links it to the one before. Missions nothing
unlocks are flagged as unreachable. The campaign starts at mission 1.1;
World 2 opens when a World 1 mission that unlocks **World 2** is completed.

**Play campaign** builds the whole campaign into `build/campaign/` and starts
it. Options: start with fresh progress, or unlock (complete) every mission for
testing. **Share** puts the campaign in the gallery, or downloads it with
the levels it uses and your unit settings as one `.wb2campaign.json` file;
**Import** loads one. The setup is
stored in `campaign/campaign.json`.

## Units tab

Edit every vehicle, robot, building and monster from the game's config:
name, speed, energy use, terrain it can use, recipe, carrying capacity,
toughness, attacks, recharging, and more, plus terrain effects and game
rules. Changed entries get a dot; each can be reset to the original. Saved
settings (`campaign/config.txt`) apply to **Play in game** and **Play
campaign**, and the level checks use them too.

## Gallery tab

Browse the levels and campaigns other players shared, as a table you can
search and sort on any column (name, type, missions, creator, plays, likes,
dislikes, date): **Play** one, 👍 or 👎 it (once each; click again to take it
back), open a level in the editor or import a campaign. Share your own
with **Share to gallery** in the Editor's Level or Campaign tab.
There are no accounts: you can delete what you shared from the same browser.
**Report** asks why: things five people report as spam or inappropriate are
hidden, and once two players report something as impossible to finish, the
gallery shows a warning on it.

Online, the gallery is the site's front page,
<https://jbrotherman.github.io/worldbuilder2-level-editor/>, which needs no
game files to look around; shared links (`…/#g=<id>`) open there, and the
editor's Gallery tab leads there. **Add game files** (top right) or **Play**
asks once for the folder your
WorldBuilder2 folder is in (WorldBuilder too, if you have it), builds the
level or campaign from that copy of the game, and saves it right next to it
as `WorldBuilder2 - <title>`, ready to start. Browsers without a folder
picker (Firefox, Safari) give a zip to unpack there instead. The local
version's Play starts the game directly.

The server is a Cloudflare Worker with a D1 database (`gallery/`):
`node gallery/dev-server.js` runs it locally (Node's built-in SQLite stands
in for D1) and `node gallery/test.js` tests it. `gallery/wrangler.toml`
lists the deploy steps.

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
| `tools/paths.js` | Where the game folders are (`settings.json`) |
| `tools/game.js` | Load the game, patch levels, write a playable build |
| `tools/catalog.js` | Units, recipes and terrain from the game's config |
| `tools/server.js` | Editor server and API |
| `tools/extract.js` | Dump all game text (levels, config) to `extracted/` |
| `tools/package.js` | Write a release zip to `build/` (no game files) |
| `tools/api.js` | The editor's API, shared by the server and the browser version |
| `web/` | Browser version: stand-ins for Node's fs, path, zlib and Buffer, and the page glue |
| `tools/build-web.js` | Build the browser version into `build/web/` |
| `tools/serve-web.js` | Try the browser version locally (`node tools/serve-web.js`) |
| `tools/test-web.js` | Check the browser version gives the same results as the local one |
| `editor/` | The editor (plain HTML/JS, no build step) |

The original game files are never modified. `WorldBuilder2/`, `WorldBuilder/`,
`settings.json`, `build/` and `extracted/` are git-ignored (LEGO's assets,
local settings, and output that can be regenerated).

## Making a release

`node tools/package.js` writes `build/WB2-Level-Editor-<date>.zip` with the
committed files from `editor/`, `tools/`, `levels/`, `campaign/`, the .bat
files, this README and the LICENSE. It refuses to include game files, and
lists what it packed; `node tools/package.js --list <zip>` lists a zip.

## The browser version

`node tools/build-web.js` bundles the editor and the tools into
`build/web/` (no build tools needed). In the browser the same code runs on
stand-ins for Node's modules (`web/node/`): an in-memory file system saved to
IndexedDB, and a small zlib. `node tools/test-web.js` checks that it gives
the same answers, sprites and game builds as the local version.
`.github/workflows/pages.yml` publishes it to GitHub Pages on every push to
`main`.

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

## Content from the original WorldBuilder

If the original game is in `WorldBuilder/` (next to `WorldBuilder2/`), or
`settings.json` points to it, the editor and every game build also get:

- **Scorpion and T-Rex graphics.** WorldBuilder 2 defines both monsters but
  only has their "frozen" pictures; WB1's walk and attack animations (and the
  scorpion's colour palettes) are copied into the game's monster cast library.
- **WB1's 60 missions** as templates: under **Open** (grouped by world) and as
  level choices in the **Campaign** tab. Two of them (Build Your Own
  Battlefield, Monsterland) use map characters WB1 never defined; those
  become plain ground.

See `tools/wb1.js`.

## License

The editor's code, levels and campaigns are under the MIT license (see
`LICENSE`). LEGO, WorldBuilder and the game files are LEGO's; they are not
included, and this project is not made or endorsed by the LEGO Group.
