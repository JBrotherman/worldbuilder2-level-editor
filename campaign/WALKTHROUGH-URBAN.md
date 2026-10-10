# Brickton City — walkthrough

The second campaign, for WorldBuilder 2's **Urban world**. It's harder than
Brickwood Valley: missions chain several ideas together, resources are
tight, monsters fight back, and the city buildings (factory, garage,
windmill, nursery) do a lot of the work. Every mission has been checked
with `tools/simulate.js` against a full solution in
`campaign/design/urban.js`; rebuild and re-check them with:

```
node campaign/design/build.js urban
```

Each mission has a **hint** and then the **solution** (spoilers!).

**City buildings, quick reference**

- **Factory:** put a tree or boulder next to it and it turns it into 25 bricks of the colour it shows (click *change colour*).
- **Garage:** makes 4 wheels next to itself, but only when no wheels are already beside it.
- **Windmill:** makes an energy brick next to itself, but only when none is beside it.
- **Nursery:** grows a tree in an empty space beside it.
- **Gas station / marina / robot lab:** recharge wheeled vehicles / boats / robots next to them.

---

### 1. Rush Hour
**Hint:** the crab owns the streets until you deal with it; the garage makes the wheels you're missing.
**Solution:** collect the defender plan and build a defender; take the crab apart. Collect the dumptruck and house plans, let the garage make 4 wheels, take the buggy apart beside them for 4 more and build a dumptruck. Haul the blue, green, yellow and white piles to the plot (recharge at the gas station) and build the house.
**Bonus:** collect the forklift plan, clear the leftover wheels away from the garage so it makes more, bring the crab's red bricks and energy over and build a forklift.

### 2. Factory Floor
**Hint:** there are no green or yellow bricks — but there are trees.
**Solution:** build the treebot, carry a tree to the factory's only open side, set the factory to green, and haul the 25 green bricks to the plot with the dumptruck. Repeat with yellow, then build the house. The robot lab beside the factory recharges the treebot.
**Bonus:** two more trees (red, then yellow), haul them to the corner, take the dumptruck apart there for its energy brick and build a guard tower.

### 3. Tire Trouble
**Hint:** the garage stops while wheels sit beside it.
**Solution:** collect the plans with the duck. Let the garage make wheels and build a buggy. Keep the garage running by carting every wheel away (a buggy carries 3) to the yellow bricks until you have 6+, build a bulldozer, tuck the first boulder into the niche and push the second one out of the street to reach the goal.
**Bonus:** take the last wheel and the buggy apart beside the second yellow pile and build a dumptruck.

### 4. Power Outage
**Hint:** the windmill is your only energy — and it won't make a second brick while the first is still beside it.
**Solution:** let the windmill make a brick, pick it up with the dirtbuggy, let it make another and pick that up too. Drop them by the steamshovel bricks, build the steamshovel and fill the gap in the road with earth dug from the bank. Carry the spare brick across and build the guard tower on the goal.
**Bonus:** take the steamshovel apart on the far side and build a duck for the pond.

### 5. Zoo Escape
**Hint:** frozen lions can be pushed — but only in straight lines.
**Solution:** build a freezebot, collect the bulldozer plan, and build a bulldozer from the buggy's wheels. Freeze the east lion, push it into line with its enclosure gate, then push it up into the enclosure (keep the freezebot close so it stays frozen).
**Bonus:** do the same with the west lion.

### 6. Canal Street
**Hint:** a steamshovel can only dig when its bucket is empty.
**Solution:** recycle the buggy into a steamshovel. Dig the canal from the lake to the harbour one tile at a time, dumping each load of earth into the little pond. Build a guard tower on the shore to clear the water crab, then build the freighter and sail it to the goal.
**Bonus:** build a fish from the small pile in the lake and swim it to the deep water.

### 7. Green Belt
**Hint:** the only trees are the ones the nursery grows.
**Solution:** build a defender first and deal with the crab. Build the treebot; let the nursery grow a tree, carry it across town to the factory (recharging at the robot lab) and make red bricks; haul them to the plot. Grow another tree, make yellow, haul it, and build the garage on the goal.
**Bonus:** your new garage makes wheels; take the dumptruck apart beside them and the leftover red bricks and build a buggy. (If the wheels land on a different side, carry them over first.)

### 8. Gridlock
**Hint:** the gap below the first boulder is your only way south.
**Solution:** push the first boulder east, not down; go round the top and push it down into the dead end. Push the second boulder down into its dead end, then push the third along to the end of the street and turn down to the goal.
**Bonus:** drive through the gap you kept open to the south-west corner.

### 9. Scorpion Alley
**Hint:** a boulder in a factory's mouth becomes red bricks.
**Solution:** push the boulder into the factory with the bulldozer and make red bricks. Haul them to the alley mouth and build a guard tower there; it takes out the first scorpion. Bring yellow bricks to its remains and build a second tower from its red bricks to take out the second. Drive the dumptruck to the goal (recharge at the gas station).
**Bonus:** carry the second scorpion's red bricks and energy, and more yellow, to the back yard and build a third tower.

### 10. Shark Harbor
**Hint:** sharks can't be beaten — only frozen.
**Solution:** build a freezebot and walk it onto the pier, where it keeps both sharks frozen. Build the freighter, ferry the red bricks and then the yellow bricks to the island, and build the guard tower there (its energy brick is waiting).
**Bonus:** take the freighter apart next to the blue and green bricks in the corner and build a marina.

### 11. Lion Bridge
**Hint:** a lion beats a defender — unless a repairbot is right behind it.
**Solution:** build a defender and a repairbot, walk them onto the causeway with the repairbot directly behind the defender, and take apart the first lion, then the second. Move them off the causeway and drive the dumptruck across to the goal.
**Bonus:** the lions leave yellow bricks; haul 25 of them to the house plot and build the house.

### 12. Brickton Finale
**Hint:** everything you've learned, in order: red bricks, a tower, a bridge, a house.
**Solution:** collect the bulldozer plan, build the bulldozer and push the boulder into the factory for red bricks. Haul them to the river bank and build a guard tower to take out the scorpion on the far side. Collect the steamshovel plan and build a lasting bridge (dig beside the bank, fill the river). Haul the blue and green bricks across (recharge at the gas station) and build the house on the goal.
**Bonus:** carry the scorpion's red bricks and energy to the north-east corner and build a second tower there.
