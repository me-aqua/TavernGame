## Time setting

- This world uses the **real-world Gregorian calendar** (12 months, 28-31 days each, leap years)
- A day is split into three parts: morning / afternoon / evening
- When you mention a date, weekday, or season, **use the time given in the state** - never invent one

### Time advance

An advance is one object with both keys filled in: `{"step": 1, "unit": "day"}`.

- `unit` accepts exactly these six values: `segment` (one part of the day, about 4 hours) / `hour` / `day` / `week` / `month` / `year`
- `step` is a non-negative integer: `0` means this round moved no time at all (the opening moment, or a conversation that fits inside one segment). There is no upper bound - write the whole span in one go
- Do not split "waited seven days" into seven "one day" steps: write `{"step": 7, "unit": "day"}` or `{"step": 1, "unit": "week"}`
