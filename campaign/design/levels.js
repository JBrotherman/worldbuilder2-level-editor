// The "Brickwood Valley" campaign: 12 levels with written solutions.
// Run: node campaign/design/build.js  (writes levels/, checks every solution)
//
// Map legend: letters/digits defined in `items`; everything else is terrain
// (M mountain, . grass, w water, x deep water, _ rocky, T tree, % jungle wall).
'use strict';

module.exports = [
  {
    file: 'Brickwood 01 First Bricks',
    title: 'First Bricks',
    map: [
      'MMMMMMMMMMMM',
      'M*.T...?wwwM',
      'M.a..b..w1wM',
      'M.......wwwM',
      'M..c.....d.M',
      'MT....T....M',
      'M%.....2..TM',
      'MMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,duck,2',
      c: 'pile,yellow,5,energy,1',
      d: 'plan,snail,1',
      1: 'goal,duck,water',
      2: 'bonusgoal,snail',
    },
    solution: `
      unit car 2,2
      move car 5,2          # drive onto the duck plan
      build duck 3,3 duck   # next to the yellow bricks
      move duck 9,2         # swim to the goal in the pond
      goal
      # Bonus: take the buggy apart and use its red bricks for a snail
      move car 9,4          # snail plan
      apart car
      build snail 9,5 snail
      move snail 7,6
      bonus`,
  },
  {
    file: 'Brickwood 02 Rocky Road',
    title: 'Rocky Road',
    map: [
      'MMMMMMMMMMMMMM',
      'M*...T..__.?.M',
      'M.a.....__.d.M',
      'M..b....__...M',
      'M.......__..1M',
      'M.c..T..__...M',
      'M.......__wwwM',
      'M&......__w2wM',
      'MMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,dirtbuggy,1',
      c: 'pile,yellow,10',
      d: 'plan,duck,1',
      1: 'goal,dirtbuggy',
      2: 'bonusgoal,duck,water',
    },
    solution: `
      unit car 2,2
      move car 3,3          # dirtbuggy plan
      move car 2,4
      apart car             # its wheels and energy brick are needed
      build dirtbuggy 3,5 db
      move db 11,2          # over the rocks; duck plan
      move db 12,4
      goal
      move db 10,5
      apart db
      build duck 11,5 duck
      move duck 11,7
      bonus`,
  },
  {
    file: 'Brickwood 03 Heavy Lifting',
    title: 'Heavy Lifting',
    map: [
      'MMMMMMMMMMMMMMMM',
      'M.b....T....d.*M',
      'M..............M',
      'M.a....T..TT...M',
      'M.......1......M',
      'M..c...T.......M',
      'M&..........e..M',
      'MT..f....TT....M',
      'M.......g...h.2M',
      'MMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      b: 'pile,blue,20',
      c: 'pile,green,20',
      d: 'pile,yellow,20',
      e: 'pile,white,25',
      f: 'plan,house,1',
      g: 'plan,forklift,1',
      h: 'pile,red,15',
      i: 'unit,building,gas_station',
      1: 'goal,house',
      2: 'bonusgoal,forklift',
    },
    extra: { i: [5, 3] },
    solution: `
      unit dt 2,3
      move dt 4,7           # house plan
      move dt 3,6
      load dt 3,5           # green
      move dt 7,4
      unload dt 8,5         # drop everything right around the goal
      move dt 4,3           # gas station: recharge
      move dt 2,2
      load dt 2,1           # blue
      move dt 8,3
      unload dt 7,4
      move dt 4,3           # recharge
      move dt 12,2
      load dt 12,1          # yellow
      move dt 9,3
      unload dt 9,4
      move dt 4,3           # recharge
      move dt 12,5
      load dt 12,6          # white
      move dt 10,5
      unload dt 9,5
      move dt 11,4
      build house 8,4
      goal
      move dt 4,3           # recharge
      move dt 8,8           # forklift plan
      move dt 11,8
      apart dt
      build forklift 12,7 fl
      move fl 14,8
      bonus`,
  },
  {
    file: 'Brickwood 04 Bridge Builder',
    title: 'Bridge Builder',
    map: [
      'MMMMMMMMMMMMMM',
      'M*....www...?M',
      'M.a...www..1.M',
      'M..b..www....M',
      'M.....www.d..M',
      'M.c...www.T.%M',
      'M.....www..e.M',
      'M..T..www...2M',
      'MMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,steamshovel,1',
      c: 'pile,yellow,25',
      d: 'plan,buggy,1',
      e: 'pile,red,10',
      1: 'goal,anything',
      2: 'bonusgoal,buggy',
    },
    solution: `
      unit car 2,2
      move car 3,3          # steamshovel plan
      move car 2,4
      apart car             # wheels + energy for the steamshovel
      build steamshovel 3,5 ss
      move ss 5,4
      dig ss 4,4            # dig behind you to get earth...
      fill ss 6,4           # ...and drop it in the river
      move ss 6,4
      dig ss 5,4
      fill ss 7,4
      move ss 7,4
      dig ss 6,4
      fill ss 8,4
      move ss 8,4
      move ss 11,2
      goal
      move ss 10,4          # buggy plan
      move ss 10,6
      apart ss
      build buggy 11,7 car2
      move car2 12,7
      bonus`,
  },
  {
    file: 'Brickwood 05 Crab Cove',
    title: 'Crab Cove',
    map: [
      'MMMMMMMMMMMMMM',
      'M.a....%%%%%2M',
      'M..b...%..f%.M',
      'M......%.e.%gM',
      'M.c....%...%.M',
      'M......%%.%%.M',
      'M..TT........M',
      'M.......T....M',
      'M&........1.*M',
      'MMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dirtbuggy',
      b: 'plan,defender,1',
      c: 'pile,blue,40,yellow,25,energy,1',
      e: 'unit,monster,crab',
      f: 'plan,snail,1',
      g: 'unit,monster,crab',
      1: 'goal,snail',
      2: 'bonusgoal,defender',
    },
    solution: `
      unit db 2,1
      move db 3,2           # defender plan
      build defender 3,4 df
      move df 9,4           # into the crab's den
      fight df 9,3          # the crab leaves red bricks behind
      move df 10,2          # snail plan
      build snail 9,2 sn
      move sn 10,8
      goal
      move df 12,4          # the second crab guards the bonus
      fight df 12,3
      move df 12,1
      bonus`,
  },
  {
    file: 'Brickwood 06 Treebot Trail',
    title: 'Treebot Trail',
    map: [
      'MMMMMMMMMMMMMMMM',
      'M.a....TTTT...?M',
      'M..b...TTTT..1.M',
      'M......T.TT....M',
      'M.c....TTTT....M',
      'M.......T.T....M',
      'M......TTTT.TTTM',
      'M......TTTT.T2TM',
      'M%.....TTTT.TTTM',
      'MMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,treebot,1',
      c: 'pile,green,20,blue,25,energy,1',
      1: 'goal,buggy',
      2: 'bonusgoal,treebot',
    },
    solution: `
      unit car 2,1
      move car 3,2          # treebot plan
      build treebot 3,4 tb
      move tb 6,4
      uproot tb 7,4         # a treebot can hold one tree at a time:
      plant tb 6,5          # plant it somewhere out of the way
      move tb 7,4
      uproot tb 8,4
      plant tb 7,5          # small clearings in the forest
      move tb 8,4
      uproot tb 9,4
      plant tb 8,3
      move tb 9,4
      uproot tb 10,4
      plant tb 9,5
      move tb 12,5
      move car 13,2
      goal
      move tb 13,5
      uproot tb 13,6        # open the grove
      plant tb 14,5
      move tb 13,7
      bonus`,
  },
  {
    file: 'Brickwood 07 Boulder Pass',
    title: 'Boulder Pass',
    map: [
      'MMMMMMMMMMMMMMMM',
      'M.....*MMMMMM1MM',
      'M.a....MMMMM.f.M',
      'M..b...MMMMM.g.M',
      'M.c.....e......M',
      'M......MMMMMwwwM',
      'M%.....MMMMMw2wM',
      'MMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      b: 'plan,dozer,1',
      c: 'pile,energy,1',
      e: 'unit,monster,boulder',
      f: 'unit,monster,boulder',
      g: 'plan,duck,1',
      1: 'goal,anything',
      2: 'bonusgoal,duck,water',
    },
    solution: `
      unit dt 2,2
      move dt 3,3           # dozer plan
      apart dt              # a dumptruck has just the bricks for a dozer
      build dozer 4,4 dz
      move dz 7,4
      push dz 8,4           # shove the boulder through the canyon
      move dz 8,4
      push dz 9,4
      move dz 9,4
      push dz 10,4
      move dz 10,4
      push dz 11,4
      move dz 11,4
      push dz 12,4
      move dz 12,2
      push dz 13,2          # clear the way into the summit
      move dz 13,1
      goal
      move dz 13,3          # duck plan
      build duck 2,3 duck   # leftover yellow bricks + the spare energy brick
      move duck 13,6
      bonus`,
  },
  {
    file: 'Brickwood 08 Island Hopping',
    title: 'Island Hopping',
    map: [
      'MMMMMMMMMMMMMMMM',
      'M....wwxxxww..?M',
      'M.a..wbxxxww.1.M',
      'M....wwxdxww...M',
      'M....wwxxxww...M',
      'M....cwxxxww..%M',
      'M.h..wwxxxww...M',
      'M...fwexxxww.g.M',
      'M....wwxxxww.i.M',
      'M?...wwxxxww.2.M',
      'MMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,duck',
      b: 'waterplan,fish,1',
      c: 'waterpile,blue,5,energy,1',
      d: 'waterplan,tugboat,1',
      e: 'waterpile,blue,15,energy,1',
      f: 'pile,red,5',
      g: 'pile,energy,1',
      h: 'plan,snail,1',
      i: 'pile,energy,1',
      1: 'goal,snail',
      2: 'bonusgoal,duck',
    },
    inventory: { duck: 1 },
    solution: `
      unit dk 2,2
      move dk 6,2           # fish plan
      move dk 2,6           # snail plan
      build fish 5,4 fish
      move fish 8,3         # only fish and boats cross the deep water
      build tugboat 6,6 tug
      move tug 5,7
      load tug 4,7          # 5 red bricks
      move tug 11,7
      unload tug 12,7
      build snail 12,6 sn
      move sn 13,2
      goal
      # Bonus: ferry the duck across in pieces
      move dk 4,6
      apart dk
      move tug 5,6
      load tug 4,6 yellow
      move tug 11,8
      unload tug 12,8
      build duck 12,9 dk2
      move dk2 13,9
      bonus`,
  },
  {
    file: 'Brickwood 09 Running on Empty',
    title: 'Running on Empty',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'Mia.cd...........M',
      'MMMMMMMMMMMMMMMM.M',
      'M................M',
      'M.MMMMMMMMMMMMMMMM',
      'M........e.......M',
      'MMMMMMMM.MMMMMMM.M',
      'M.1..h...........M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      c: 'pile,white,25',
      d: 'pile,red,15,wheel,5,energy,1',
      e: 'pile,red,40,green,5',
      h: 'pile,red,10',
      i: 'unit,building,gas_station',
      1: 'goal,windmill',
      2: 'bonusgoal,buggy',
    },
    extra: { 2: [16, 5] },
    inventory: { windmill: 1, gas_station: 1, buggy: 1 },
    solution: `
      unit dt 2,1
      build gas_station 8,6 st   # in the little alcove near the end
      move dt 3,1
      load dt 4,1           # white bricks
      move dt 8,5           # recharge at your new station
      move dt 3,7
      unload dt 3,7
      move dt 8,5           # recharge
      move dt 6,1
      load dt 5,1           # red, wheels, energy
      move dt 2,1           # recharge at the start station
      move dt 8,5           # recharge
      move dt 3,7
      unload dt 3,7
      move dt 4,7
      build windmill 2,7
      goal
      move dt 5,7
      apart dt
      build buggy 6,7 car
      move car 16,5
      bonus`,
  },
  {
    file: 'Brickwood 10 Frozen Fury',
    title: 'Frozen Fury',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.a..MMMMMMMMM...M',
      'M..b.MMMMMMMMM.1.M',
      'M................M',
      'M.c........e.....M',
      'M................M',
      'M.fd.MMMMMM.MM...M',
      'M...&MMMMMM2MM%.*M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,freezebot,1',
      c: 'pile,blue,5,red,5,white,10,yellow,25,energy,1',
      d: 'plan,dozer,1',
      e: 'unit,monster,trex',
      f: 'pile,yellow,15,wheel,6,energy,1',
      1: 'goal,buggy',
      2: 'bonusgoal,collect 1 trex',
    },
    solution: `
      unit car 2,1
      move car 3,2          # freezebot plan
      build freezebot 3,4 fz
      move fz 9,4           # within two tiles of the T-Rex
      freeze fz 11,4
      move car 15,2         # race past while it's frozen
      goal
      # Bonus: push the frozen T-Rex into its pen
      move car 3,6          # dozer plan (drive back past it)
      build dozer 1,6 dz
      move dz 11,3
      push dz 11,4
      move dz 11,4
      push dz 11,5
      move dz 11,5
      push dz 11,6
      bonus`,
  },
  {
    file: 'Brickwood 11 Scorpion Stronghold',
    title: 'Scorpion Stronghold',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.a......%.....k2M',
      'M..b.....%.......M',
      'M........%.......M',
      'M......c.%...g...M',
      'M.........h......M',
      'M......d.%.......M',
      'M........%.......M',
      'M........%.....1.M',
      'M%.......%.*....?M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      b: 'plan,guard_tower,3',
      c: 'pile,red,25,yellow,25,energy,1',
      d: 'pile,yellow,25,energy,1',
      k: 'pile,yellow,25,energy,1',
      g: 'unit,monster,scorpion',
      h: 'unit,monster,scorpion',
      1: 'goal,dumptruck',
      2: 'bonusgoal,guard_tower',
    },
    solution: `
      unit dt 2,1
      move dt 3,2           # guard tower plans
      build guard_tower 8,4 t1   # beside the gate, in range of the first scorpion
      fight t1 10,5
      move dt 7,5
      load dt 7,6 yellow
      move dt 10,4
      unload dt 11,4
      build guard_tower 11,5 t2  # uses the first scorpion's red bricks
      fight t2 13,4
      move dt 15,8
      goal
      # Bonus: a tower on the far battlement
      move dt 13,5
      load dt 13,4 red      # the second scorpion's bricks
      move dt 15,2
      unload dt 16,2
      move dt 14,3
      build guard_tower 16,1
      bonus`,
  },
  {
    file: 'Brickwood 12 The Last Expedition',
    title: 'The Last Expedition',
    map: [
      'MMMMMMMMMMMMMMMMMMMMMM',
      'M.a...TTT?....www.s.2M',
      'M..b..TTT...p.www....M',
      'M.....TTT..y..www..k.M',
      'M.c...TTT.....www...*M',
      'M......TT.....www....M',
      'M.....TTT.....www.e.fM',
      'M.....T.T.....www..1.M',
      'M.....TTT.....www.h.iM',
      'M.....TTT.....www....M',
      'M.....TTT.dj..www...lM',
      'M%....TTT....&www%...M',
      'MMMMMMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dirtbuggy',
      b: 'plan,treebot,1',
      c: 'pile,green,20,blue,25,energy,1',
      d: 'plan,defender,1',
      e: 'pile,blue,20',
      f: 'pile,green,20',
      h: 'pile,yellow,20',
      i: 'pile,white,25',
      j: 'pile,blue,40,yellow,25,energy,1',
      k: 'unit,monster,crab',
      l: 'plan,house,1',
      p: 'plan,steamshovel,1',
      s: 'plan,snail,1',
      y: 'pile,yellow,15,energy,1',
      1: 'goal,house',
      2: 'bonusgoal,snail',
    },
    solution: `
      unit db 2,1
      move db 3,2           # treebot plan
      build treebot 3,4 tb
      move tb 5,6           # tunnel through the forest
      uproot tb 6,6
      plant tb 5,5
      move tb 6,6
      uproot tb 7,6
      plant tb 6,5
      move tb 7,6
      uproot tb 8,6
      plant tb 7,7
      move tb 10,8
      move db 10,10         # defender plan
      move db 12,2          # steamshovel plan
      move db 11,4
      apart db
      build steamshovel 12,4 ss
      build defender 12,10 df    # stays behind until the bridge is done
      # A lasting bridge: dig earth beside the path, never behind you
      move ss 13,4
      dig ss 13,3
      fill ss 14,4
      move ss 12,5
      dig ss 13,5
      move ss 14,4
      fill ss 15,4
      move ss 12,6
      dig ss 13,6
      move ss 15,4
      fill ss 16,4
      move ss 12,8          # back out of the way
      move df 19,4          # over the bridge to the crab
      fight df 19,3
      move df 20,10         # house plan
      build house 19,7
      goal
      move df 18,1          # snail plan
      build snail 19,2 sn
      move sn 20,1
      bonus`,
  },
];
