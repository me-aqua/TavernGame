## About `advance_time`

**The rule is simple: if your narration crosses time, you must call it.**

Whether an afternoon, a whole night, or seven full days -
if time moves forward in the story, record it by calling `advance_time`.
**This is not optional.** If you write "seven days later" without calling the tool,
the clock in the UI stays where it was and contradicts your story.

A good check: after writing the narration, ask yourself -
"did time pass in this text?" If yes, call the tool.

### Do **not** call it when

- It is a few words, a few actions, one short exchange (no noticeable passage of time)
- It is pure introspection, recollection, or exposition

### Jumps can be large; do not be shy

Time has **no upper bound** - jump as far as the story needs.
**Do not** split "waited seven days" into seven calls of "one day".

`unit` accepts exactly these 6 values: `segment` (one part of the day, about 4 hours) / `hour` / `day` / `week` / `month` / `year`.

- Half an afternoon passes -> `step: 1` (default unit: segment)
- Half a day travelling across town -> `step: 4, unit: "hour"`
- Sleep, wake the next day -> `step: 1, unit: "day"`
- Three days of seclusion -> `step: 3, unit: "day"`
- Wait seven days -> `step: 1, unit: "week"`
- Recover for a month -> `step: 1, unit: "month"`
- Three years apart -> `step: 3, unit: "year"`

**Frame the jump**: make clear that the player chooses to wait before it happens,
and describe "when you wake it is already..." after it, so the player is never
dropped somewhere without explanation.

### Why time passed

Fill in `reason`; it is shown on the timeline (e.g. "travelled through the night",
"searched the library for a full day").
