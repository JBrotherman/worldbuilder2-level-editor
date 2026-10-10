// "Brickton City": 12 harder missions for the Urban world (World 2).
// Roads are drawn with "R" (build.js picks the right road piece).
// Other legend: M mountain, . grass, w water, x deep water, _ rocky,
// T tree, * hedge (rocks & flowers), % flowers, ` cement, > roadblock.
'use strict';

module.exports = [
  {
    file: 'Brickton 01 Rush Hour',
    title: 'Rush Hour',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.a..R......R.p..M',
      'M..b.R.c....R....M',
      'MRRRRRRRRRRRRRRRRM',
      'M....R.*T.T.R..q.M',
      'M.d..R.*fy..R.k..M',
      'M....R.*T.T.R....M',
      'M.h..R......R..g.M',
      'MRRRRRRRRRRRRRRRRM',
      'M.s..R......R....M',
      'M.v..R..t...R.1.2M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,defender,1',
      c: 'pile,blue,40,yellow,25,energy,1',
      d: 'plan,dumptruck,1',
      f: 'unit,building,garage',
      g: 'unit,building,gas_station',
      h: 'plan,house,1',
      k: 'unit,monster,crab',
      p: 'pile,blue,20',
      q: 'pile,green,20',
      s: 'pile,yellow,20',
      t: 'pile,white,25',
      v: 'plan,forklift,1',
      y: 'pile,yellow,20,energy,1',
      1: 'goal,house',
      2: 'bonusgoal,forklift',
    },
    solution: `
      unit car 2,1
      unit gar 8,5
      move car 3,2          # defender plan
      build defender 7,1 df
      move df 14,4
      fight df 14,5         # the crab roams the streets: deal with it first
      move car 2,5          # dumptruck plan
      move car 2,7          # house plan
      produce gar 9,4       # the garage makes 4 wheels
      move car 9,6
      apart car             # 4 more wheels
      build dumptruck 10,5 dt
      move dt 13,1
      load dt 14,1          # blue
      move dt 13,9
      unload dt 13,10
      move dt 15,5
      load dt 15,4          # green
      move dt 15,6          # recharge at the gas station
      move dt 14,9
      unload dt 15,9
      move dt 3,9
      load dt 2,9           # yellow
      move dt 13,9
      unload dt 14,9
      move dt 8,9
      load dt 8,10          # white
      move dt 15,10
      unload dt 15,10
      build house 14,10
      goal
      # Bonus: a forklift from the crab's red bricks and fresh wheels
      move dt 15,6          # recharge
      move dt 2,10          # forklift plan
      move dt 10,5
      load dt 9,6 wheel     # the garage only works with no wheels beside it
      move dt 11,5
      unload dt 11,6
      produce gar 9,4
      move df 13,5
      move dt 15,5
      load dt 14,5          # the crab's red bricks and energy
      move dt 11,4
      unload dt 10,4
      build forklift 10,5 fl
      move fl 16,10
      bonus`,
  },
  {
    file: 'Brickton 02 Factory Floor',
    title: 'Factory Floor',
    map: [
      'MMMMMMMMMMMMMMMM',
      'M.***.l.......aM',
      'M.*f.RRRRRRRRR.M',
      'M.***R.......RgM',
      'M.c..R.TT.T..R.M',
      'M....R..T....R.M',
      'MRRRRRRRRRRRRR.M',
      'M....R.......R.M',
      'M....R....b1dR.M',
      'M....R.......R2M',
      'MMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      b: 'pile,blue,20',
      c: 'pile,green,20,blue,25,energy,1',
      d: 'pile,white,25',
      f: 'unit,building,factory',
      g: 'unit,building,gas_station',
      l: 'unit,building,robot_lab',
      1: 'goal,house',
      2: 'bonusgoal,guard_tower',
    },
    inventory: { treebot: 1, house: 1, guard_tower: 1 },
    solution: `
      unit dt 14,1
      unit fac 3,2
      build treebot 3,4 tb
      move tb 6,4
      uproot tb 7,4         # carry a tree to the factory's only free side
      move tb 5,2           # (the robot lab next door recharges the treebot)
      plant tb 4,2
      produce fac 4,2 green # set the factory to green: 25 green bricks
      move tb 6,3
      move dt 5,1
      load dt 4,2
      move dt 11,7
      unload dt 11,7
      move tb 8,3
      uproot tb 8,4
      move tb 5,2
      plant tb 4,2
      produce fac 4,2 yellow
      move tb 6,3
      move dt 5,1
      load dt 4,2
      move dt 12,7
      unload dt 12,7
      build house 11,8
      goal
      # Bonus: two more trees (red, yellow) for a guard tower
      move dt 14,2          # recharge at the gas station
      move tb 10,3
      uproot tb 10,4
      move tb 5,2
      plant tb 4,2
      produce fac 4,2 red
      move tb 6,3
      move dt 5,1
      load dt 4,2
      move dt 14,7
      unload dt 14,8
      move dt 14,2          # recharge
      move tb 8,6
      uproot tb 8,5
      move tb 5,2
      plant tb 4,2
      produce fac 4,2 yellow
      move tb 6,3
      move dt 5,1
      load dt 4,2
      move dt 13,7
      unload dt 13,8
      move dt 13,9
      apart dt              # its energy brick powers the tower
      build guard_tower 14,9
      bonus`,
  },
  {
    file: 'Brickton 03 Tire Trouble',
    title: 'Tire Trouble',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M***p.a.b...*****M',
      'M*f.......c......M',
      'M***i............M',
      'M.y....**********M',
      'M......**.****...M',
      'M.......e..h.....M',
      'M.z....*..****...M',
      'M......*******1..M',
      'M......*******..2M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,duck',
      b: 'plan,buggy,1',
      c: 'plan,dozer,1',
      e: 'unit,monster,boulder',
      f: 'unit,building,garage',
      h: 'unit,monster,boulder',
      i: 'plan,dumptruck,1',
      p: 'pile,red,10,energy,1',
      y: 'pile,yellow,15,energy,1',
      z: 'pile,yellow,20,energy,1',
      1: 'goal,anything',
      2: 'bonusgoal,dumptruck',
    },
    solution: `
      unit dk 6,1
      unit gar 2,2
      move dk 8,1           # buggy plan
      move dk 10,2          # dozer plan
      move dk 4,3           # dumptruck plan
      produce gar 3,2       # the garage puts 4 wheels on its only free side
      build buggy 4,2 car
      produce gar 3,2       # ...and makes more once that side is clear again
      load car 3,2          # a buggy carries 3
      move car 3,5
      unload car 2,5
      move car 4,2
      load car 3,2          # the last wheel, or the garage stays idle
      move car 3,5
      unload car 2,5
      move car 4,2
      produce gar 3,2
      load car 3,2
      move car 3,5
      unload car 2,5        # 7 wheels by the yellow bricks
      move car 4,2
      build dozer 3,4 dz
      move dz 7,6
      push dz 8,6           # tuck the first boulder into the niche...
      move dz 8,6
      move dz 9,7
      push dz 9,6
      move dz 10,6          # ...then shove the second one out of the street
      push dz 11,6
      move dz 11,6
      push dz 12,6
      move dz 12,6
      push dz 13,6
      move dz 13,6
      push dz 14,6
      move dz 14,8
      goal
      load car 3,2          # Bonus: the last wheel...
      move car 2,6
      unload car 2,6
      apart car             # ...plus the buggy's own 4
      build dumptruck 3,6 dt
      move dt 16,9
      bonus`,
  },
  {
    file: 'Brickton 04 Power Outage',
    title: 'Power Outage',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M*o*......w...w2wM',
      'M*.*......w...wwwM',
      'M.........w......M',
      'M.......p.w......M',
      'MRRRRRRRRRwRRRRRRM',
      'M.a.......w....q1M',
      'M.........w......M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dirtbuggy',
      o: 'unit,building,windmill',
      p: 'pile,yellow,25,wheel,4',
      q: 'pile,red,25,yellow,25',
      1: 'goal,guard_tower',
      2: 'bonusgoal,duck,water',
    },
    inventory: { steamshovel: 1, guard_tower: 1, duck: 1 },
    solution: `
      unit db 2,6
      unit wm 2,1
      produce wm 2,2        # no energy bricks anywhere: the windmill makes one...
      move db 2,3
      load db 2,2
      produce wm 2,2        # ...and only makes the next once you've taken it away
      load db 2,2
      move db 9,6
      unload db 9,6         # both energy bricks by the steamshovel bricks
      build steamshovel 8,5 ss
      load db 9,6           # take the spare one along
      move ss 9,5
      dig ss 9,4            # earth from the bank...
      fill ss 10,5          # ...closes the gap in the road
      move ss 8,6
      move db 16,5
      unload db 16,5
      build guard_tower 16,6
      goal
      move ss 11,4          # Bonus: recycle the steamshovel into a duck
      apart ss
      build duck 12,4 dk
      move dk 15,1
      bonus`,
  },
  {
    file: 'Brickton 05 Zoo Escape',
    title: 'Zoo Escape',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M***2*******1****M',
      'M***.*******.****M',
      'M***.*******.****M',
      'M.a..........R...M',
      'M.b..e.......l...M',
      'M....RRRRRRRRR...M',
      'M.c..R.......R...M',
      'M.d..R...f...R...M',
      'M....R.......R...M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'plan,freezebot,1',
      c: 'pile,blue,5,red,5,white,10,yellow,25,energy,1',
      d: 'pile,yellow,15,wheel,2,energy,1',
      e: 'unit,monster,lion',
      f: 'plan,dozer,1',
      l: 'unit,monster,lion',
      1: 'goal,collect 1 lion',
      2: 'bonusgoal,collect 1 lion',
    },
    solution: `
      unit car 2,4
      move car 2,5          # freezebot plan
      build freezebot 3,7 fz
      move car 9,8          # bulldozer plan
      move car 2,9
      apart car             # its wheels go into the bulldozer
      build dozer 3,9 dz
      move fz 11,5          # freeze the lion by the east enclosure
      freeze fz 13,5
      move dz 14,5
      push dz 13,5          # line it up with the gate...
      move dz 12,6
      push dz 12,5          # ...and push it home, keeping the freezebot close
      move fz 11,4
      move dz 12,5
      push dz 12,4
      move dz 12,4
      push dz 12,3
      move dz 12,3
      push dz 12,2
      goal
      move fz 6,4           # Bonus: the second lion
      freeze fz 5,5
      move dz 6,5
      push dz 5,5
      move dz 4,6
      push dz 4,5
      move dz 4,5
      push dz 4,4
      move dz 4,4
      push dz 4,3
      move dz 4,3
      push dz 4,2
      bonus`,
  },
  {
    file: 'Brickton 06 Canal Street',
    title: 'Canal Street',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.a..b...........M',
      'M.c..............M',
      'M.....RRRRRRRRRR.M',
      'M....*...*.......M',
      'M....www.*.d.....M',
      'Mwwww............M',
      'Mweww...wwwwwwwwwM',
      'Mwwww...wwwkwwww1M',
      'Mwwfw...wwwwwwwx2M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'pile,yellow,25,energy,1',
      c: 'plan,steamshovel,1',
      d: 'pile,red,25,yellow,25,energy,1',
      e: 'waterpile,blue,25,energy,1',
      f: 'waterpile,blue,5,energy,1',
      k: 'waterunit,monster,water_crab',
      1: 'goal,freighter,water',
      2: 'bonusgoal,fish,water',
    },
    inventory: { freighter: 1, guard_tower: 1, fish: 1 },
    solution: `
      unit car 2,1
      move car 2,2          # steamshovel plan
      move car 3,1
      apart car
      build steamshovel 4,1 ss
      move ss 5,7           # dig the canal one tile at a time...
      dig ss 5,8
      move ss 5,6
      fill ss 5,5           # ...dumping each load of earth in the pond
      move ss 6,7
      dig ss 6,8
      move ss 6,6
      fill ss 6,5
      move ss 7,7
      dig ss 7,8
      move ss 7,6
      fill ss 7,5
      build guard_tower 11,6 t1   # the tower clears the water crab
      fight t1 11,8
      build freighter 2,8 fr
      move fr 16,8
      goal
      build fish 3,8 fish
      move fish 16,9
      bonus`,
  },
  {
    file: 'Brickton 07 Green Belt',
    title: 'Green Belt',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.a......R....l**M',
      'M.c......R......fM',
      'M........R.....**M',
      'MRRRRRRRRRRRRRRR.M',
      'M....k...R.......M',
      'M...d....R..y1...M',
      'M***.....R.......M',
      'M*n......R....2..M',
      'M***.....R.......M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      c: 'pile,green,20,blue,25,energy,1',
      d: 'pile,blue,40,yellow,25,energy,1',
      f: 'unit,building,factory',
      k: 'unit,monster,crab',
      l: 'unit,building,robot_lab',
      n: 'unit,building,nursery',
      y: 'pile,white,25,energy,1',
      1: 'goal,garage',
      2: 'bonusgoal,buggy',
    },
    inventory: { defender: 1, treebot: 1, garage: 1, buggy: 1 },
    solution: `
      unit dt 2,1
      unit fac 16,2
      unit nur 2,8
      build defender 4,7 df
      move df 5,4
      fight df 5,5          # the crab would wreck your treebot
      build treebot 3,2 tb
      produce nur 3,8       # the nursery grows a tree on its free side
      move tb 4,8
      uproot tb 3,8
      move tb 14,2          # across town (the robot lab recharges it)
      plant tb 15,2
      produce fac 15,2 red
      move tb 13,2
      move dt 14,3
      load dt 15,2
      move dt 13,5
      unload dt 13,5
      produce nur 3,8       # grow another
      move tb 4,8
      uproot tb 3,8
      move tb 14,2
      plant tb 15,2
      produce fac 15,2 yellow
      move tb 13,2
      move dt 14,3
      load dt 15,2
      move dt 14,6
      unload dt 14,6
      build garage 13,6 gar
      goal
      # Bonus: the garage makes wheels; the leftover red bricks make a buggy
      produce gar 14,5
      move dt 14,4
      apart dt
      build buggy 13,4 car
      move car 14,8
      bonus`,
  },
  {
    file: 'Brickton 08 Gridlock',
    title: 'Gridlock',
    map: [
      'MMMMMMMMMMMMMM',
      'M.a..........M',
      'M............M',
      'M*.***.*.****M',
      'M...e...f.h..M',
      'M***.*.*.**.*M',
      'M....******1*M',
      'M....********M',
      'M2...********M',
      'MMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dozer',
      e: 'unit,monster,boulder',
      f: 'unit,monster,boulder',
      h: 'unit,monster,boulder',
      1: 'goal,anything',
      2: 'bonusgoal,anything',
    },
    solution: `
      unit dz 2,1
      move dz 3,4
      push dz 4,4           # NOT down into the gap below: that's your way south
      move dz 4,4
      push dz 5,4
      move dz 6,3           # round the top, then down into the dead end
      push dz 6,4
      move dz 8,3
      push dz 8,4
      move dz 9,4
      push dz 10,4
      move dz 10,4
      push dz 11,4
      move dz 11,6
      goal
      move dz 1,8
      bonus`,
  },
  {
    file: 'Brickton 09 Scorpion Alley',
    title: 'Scorpion Alley',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M***.............M',
      'M*f..e.a.........M',
      'M***....y********M',
      'M........*.......M',
      'M.b.......h..g..1M',
      'M...z.j..*.......M',
      'M........*******.M',
      'M*********......2M',
      'M*********.......M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dozer',
      b: 'unit,vehicle,dumptruck',
      e: 'unit,monster,boulder',
      f: 'unit,building,factory',
      g: 'unit,monster,scorpion',
      h: 'unit,monster,scorpion',
      j: 'unit,building,gas_station',
      y: 'pile,yellow,25,energy,1',
      z: 'pile,yellow,50',
      1: 'goal,dumptruck',
      2: 'bonusgoal,guard_tower',
    },
    inventory: { guard_tower: 3 },
    solution: `
      unit dz 7,2
      unit dt 2,5
      unit fac 2,2
      move dz 6,2
      push dz 5,2           # roll the boulder into the factory's mouth
      move dz 5,2
      push dz 4,2
      produce fac 3,2 red   # 25 red bricks
      move dz 6,1
      move dt 4,3
      load dt 3,2
      move dt 7,4
      unload dt 7,4
      build guard_tower 8,4 t1   # at the mouth of the alley
      fight t1 10,5
      move dt 4,5
      load dt 4,6
      move dt 10,5
      unload dt 10,4
      build guard_tower 11,4 t2  # the first scorpion's bricks build the next tower
      fight t2 13,5
      move dt 16,5
      goal
      move dt 14,5          # Bonus: a tower in the back yard
      load dt 13,5 red
      move dt 16,6
      unload dt 16,7
      move dt 6,5           # recharge
      move dt 4,5
      load dt 4,6
      move dt 6,5           # recharge
      move dt 16,7
      unload dt 15,8
      move dt 14,5
      load dt 13,5 energy
      move dt 16,7
      unload dt 16,7
      build guard_tower 16,8
      bonus`,
  },
  {
    file: 'Brickton 10 Shark Harbor',
    title: 'Shark Harbor',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.a......b.......M',
      'M................M',
      'M..cd.....R......M',
      'Mwewwwwwww.wwwwwwM',
      'MwwwwwwwwwwwwwwwwM',
      'MwwwwwwwwkwwlwwwwM',
      'MwwwwwwwwwwwwwwwfM',
      'Mwwwwwwwwwwwwwww2M',
      'Mwwwwwwwwww..1...M',
      'Mwwwwwwwwww...h..M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,buggy',
      b: 'pile,blue,5,red,5,white,10,yellow,25,energy,1',
      c: 'pile,red,25',
      d: 'pile,yellow,25',
      e: 'waterpile,blue,25,energy,1',
      f: 'waterpile,blue,15,green,5',
      h: 'pile,energy,1',
      k: 'waterunit,monster,shark',
      l: 'waterunit,monster,shark',
      1: 'goal,guard_tower',
      2: 'bonusgoal,marina,water',
    },
    inventory: { freezebot: 1, freighter: 1, guard_tower: 1, marina: 1 },
    solution: `
      unit car 2,1
      build freezebot 9,2 fz
      move fz 10,4          # out on the pier, both sharks are in range
      freeze fz 9,6
      freeze fz 12,6
      build freighter 3,4 fr
      load fr 3,3           # red
      move fr 12,8
      unload fr 12,9
      move fr 5,4
      load fr 4,3           # yellow
      move fr 14,8
      unload fr 14,9
      build guard_tower 13,9
      goal
      move fr 15,8          # Bonus: recycle the freighter into a marina
      apart fr
      build marina 16,8
      bonus`,
  },
  {
    file: 'Brickton 11 Lion Bridge',
    title: 'Lion Bridge',
    map: [
      'MMMMMMMMMMMMMMMMMM',
      'M.....wwwwww.....M',
      'M.....wwwwww.p.q.M',
      'M.c...wwwwww..2..M',
      'M.....wwwwww.s...M',
      'M.a......l.k....1M',
      'M.....wwwwww.....M',
      'M.d...wwwwww.....M',
      'M.....wwwwww.....M',
      'MMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      c: 'pile,blue,40,yellow,25,energy,1',
      d: 'pile,blue,20,green,10,yellow,5,energy,1',
      k: 'unit,monster,lion',
      l: 'unit,monster,lion',
      p: 'pile,blue,20',
      q: 'pile,green,20',
      s: 'pile,white,25',
      1: 'goal,dumptruck',
      2: 'bonusgoal,house',
    },
    inventory: { defender: 1, repairbot: 1, house: 1 },
    solution: `
      unit dt 2,5
      build defender 3,3 df
      build repairbot 3,7 rb
      move df 8,5
      move rb 7,5           # a lion beats a defender - unless a repairbot fixes it up
      fight df 9,5
      move df 10,5
      move rb 9,5
      fight df 11,5
      move df 13,6
      move rb 12,6
      move dt 8,5
      load dt 9,5 yellow    # the lions leave yellow bricks
      move dt 15,4
      unload dt 15,4
      build house 14,3
      bonus
      move dt 16,5
      goal`,
  },
  {
    file: 'Brickton 12 Brickton Finale',
    title: 'Brickton Finale',
    map: [
      'MMMMMMMMMMMMMMMMMMMM',
      'M***.....w......2..M',
      'M*f..e...w.......z.M',
      'M***.....w.........M',
      'M.....d..w.j.......M',
      'M.k....y.w.........M',
      'M.b..p...ws........M',
      'M....q...w.........M',
      'M.a......w.........M',
      'M......t.w...1.....M',
      'M...m....w..h.i....M',
      'M........w.........M',
      'MMMMMMMMMMMMMMMMMMMM',
    ],
    items: {
      a: 'unit,vehicle,dumptruck',
      b: 'unit,vehicle,buggy',
      d: 'pile,yellow,15,wheel,6,energy,1',
      e: 'unit,monster,boulder',
      f: 'unit,building,factory',
      h: 'pile,white,25',
      i: 'pile,yellow,20',
      j: 'unit,building,gas_station',
      k: 'plan,dozer,1',
      m: 'plan,steamshovel,1',
      p: 'pile,blue,20',
      q: 'pile,green,20',
      s: 'unit,monster,scorpion',
      t: 'pile,yellow,25,wheel,4,energy,1',
      y: 'pile,yellow,25,energy,1',
      z: 'pile,yellow,25',
      1: 'goal,house',
      2: 'bonusgoal,guard_tower',
    },
    inventory: { guard_tower: 2, house: 1 },
    solution: `
      unit car 2,6
      unit dt 2,8
      unit fac 2,2
      move car 2,5          # bulldozer plan
      build dozer 6,5 dz
      move dz 6,2
      push dz 5,2           # boulder into the factory: red bricks
      move dz 5,2
      push dz 4,2
      produce fac 3,2 red
      move dz 6,1
      move dt 4,3
      load dt 3,2
      move dt 7,6
      unload dt 7,6
      build guard_tower 8,6 t1   # across the river, the scorpion is in range
      fight t1 10,6
      move car 4,10         # steamshovel plan
      build steamshovel 8,9 ss
      move ss 8,8
      dig ss 8,7            # a lasting bridge: dig beside, fill the river
      fill ss 9,8
      move ss 7,10
      move dt 6,6
      load dt 5,6           # blue
      move dt 11,8
      unload dt 12,8
      move dt 11,5          # recharge at the gas station
      move dt 6,7
      load dt 5,7           # green
      move dt 14,9
      unload dt 14,8
      build house 13,9
      goal
      move dt 11,5          # recharge
      move dt 11,6          # Bonus: the scorpion's bricks become a second tower
      load dt 10,6 red
      move dt 16,2
      unload dt 16,2
      move dt 11,5          # recharge
      move dt 11,6
      load dt 10,6 energy
      move dt 15,2
      unload dt 15,2
      move dt 14,3
      build guard_tower 16,1
      bonus`,
  },
];
