# Spyder

A personal Windows app that holds its user accountable for how they spend their working time. It does this by making every minute of work hours belong to a block the user has accounted for.

## Language

### Time frame

**Work hours**:
The user's scheduled working window for a given day (e.g. 10:00–17:00), from the weekday schedule or today's override.
_Avoid_: business hours, shift

**Off hours**:
Any time outside work hours. Activity is still recorded and no start reminders happen, but the user can still press Start; a loop started in off hours runs until Stop.
_Avoid_: after hours, personal time

**Workday %**:
The share of today's work hours that has already elapsed, from 0 to 100.
_Avoid_: day progress, completion

**Day off**:
A weekday with no work hours in the schedule. It doesn't break a streak.
_Avoid_: weekend, holiday

**Day override**:
Work hours set for today only, replacing the weekday schedule for that one day.
_Avoid_: exception, custom hours

**Keep working**:
The user's explicit choice to extend today's work hours by a fixed step (30 minutes by default) after they've ended. A running loop carries on.
_Avoid_: overtime, extend day

### Blocks

**Block**:
A stretch of the user's time, accounted for with one answer. The loop makes blocks of exactly the block length; merging adjacent blocks makes one longer block. Every moment of work hours belongs to one block or is untracked.
_Avoid_: interval, chunk, slot, timer, session (the old model)

**Block length**:
The duration the loop gives each new block, 5–180 minutes, set next to the Start button. A change applies from the next block.
_Avoid_: interval, timer setting

**Loop**:
The chain of back-to-back blocks that runs from Start until Stop or the end of work hours. Blocks start from the moment Start is pressed, not on clock boundaries. When one block ends, the next starts immediately, even if the previous one isn't accounted for yet.
_Avoid_: run, timer

**Track from startup**:
A setting under which the loop starts by itself when Spyder launches or the laptop wakes, and runs until shutdown, sleep or Stop, whatever the work hours (P76).
_Avoid_: always on, auto mode

**Account for**:
Saying in free text what a block was spent on, once it has ended. Several unanswered blocks are accounted for in one prompt, together or one by one.
_Avoid_: log, label

**Answer**:
The free text that says what a block was spent on. Consecutive blocks with the same answer are shown joined but stay separate blocks until merged.
_Avoid_: label, name

**Tag**:
Whether a block is Work, Break, Gym, Food or Sleep. Every block has exactly one tag, set apart from its answer and changeable after the fact. Gym and Food are kinds of break: their time counts as break time (P74). Sleep counts as neither work nor break (P105).
_Avoid_: kind, type, category (categories are for activity)

**Work block**:
A block tagged Work. Its time is work time.

**Break block**:
A block tagged Break, Gym or Food. It may have an answer (e.g. "took a nap") or none, in which case it reads its tag ("Break", "Gym", "Food"). It isn't work time.
_Avoid_: pause

**Computer asleep or off**:
Work-hours time when the loop was running but the laptop slept or Spyder wasn't running. It becomes a break block reading "Computer asleep or off", which the prompt asks about on return (P95). Time outside work hours stays untracked, unless Settings asks about it all day: then it becomes a sleep block reading the same (P105).
_Avoid_: sleep gap, downtime

**Sleep block**:
A block tagged Sleep. Spyder makes one for time asleep or off outside work hours when Settings asks about it all day, and any block can be tagged Sleep by hand. It's neither work nor break time and isn't a leftover (P105).

**Away time** (in a block):
Minutes within a block when the user wasn't at the computer. The loop keeps running; away time is shown as a hint when the block is accounted for and isn't asked about separately.

**Start reminder**:
During work hours with no loop running, the bar shows "Not started" highlighted and a prompt with a Start button repeats every block length.
_Avoid_: nag

**Merge**:
Joining neighbouring blocks (nothing shown between them in the block log: no other block, away time or untracked span) into one longer block with one answer, picked by the user. Blocks with different tags can't be merged. **Merge repeats** merges every run of neighbours with the same tag and answer at once (P73).
_Avoid_: combine, join

**Unmerge**:
Splitting a merged block back into the blocks its latest merge combined, each as it was before that merge (P86). Works any time after the merge, unlike Undo.
_Avoid_: split, unjoin

**Delete**:
Removing a block after the fact. Its time becomes untracked.
_Avoid_: discard, remove

**Untracked**:
Work-hours time that belongs to no block: before Start was pressed, or because the user deleted the block it was in. It doesn't count as work time and isn't a leftover. Any untracked span can be accounted for later on Today, which turns it into a block (P95).
_Avoid_: gap, unaccounted, deleted time

### Activity

**Activity**:
A record of which app (and website, for browsers) was in the foreground, and for how long.
_Avoid_: usage, event, sample

**Category**:
How an app or site counts: Productive, Neutral, Distracting, or Uncategorized. It's derived from rules.
_Avoid_: label, type

**Rule**:
A user- or default-defined mapping from an app, domain or title keyword to a category.

**To sort**:
Apps and sites used 3 min or more whose category no rule of the user's decides yet (none, or only a default). Spyder asks about them in Rules and in the end-of-block prompt (P70).

**Title pattern**:
A mapping from a Firefox window title to the site it shows (e.g. a title ending in "- YouTube" means youtube.com).
_Avoid_: title rule (rules assign categories; title patterns identify sites)

**Private browsing**:
Activity in a private browser window. It's recorded without a title or site and can't be categorized.
_Avoid_: incognito

**Distraction**:
Time spent on Distracting apps/sites in blocks that aren't break blocks.

**Nudge**:
A real-time warning shown after 5 continuous minutes of distraction while the loop is running.
_Avoid_: block, alert

### Accountability

**Work time**:
Time in blocks that aren't break blocks, including blocks not yet accounted for.

**Productive time**:
Work time minus distraction time.
_Avoid_: focus time, deep work

**Daily goal**:
The amount of productive time the user aims for each workday.

**Goal %**:
Today's productive time as a percentage of the daily goal. It can pass 100.
_Avoid_: goal progress, completion

**Day score**:
Productive time as a percentage of scheduled work hours.
_Avoid_: focus score, productivity score

**Efficiency**:
The user's own rating of how well a work block went: 25, 50, 75 or 100 %, or not rated. For a day or range, rated work time weighted by its rating as a percentage of rated work time. Unrelated to productive time.
_Avoid_: focus, quality score

**Effective time**:
Rated work time weighted by its efficiency (1h at 50 % is 30m effective).

**Streak**:
The number of consecutive scheduled workdays on which the daily goal was met.

**Review**:
The end-of-day ritual: account for leftover blocks, look at the day, and write wins and improvements.
_Avoid_: report (the report is what the review looks at), journal

**Leftover**:
A finished block that hasn't been accounted for, which the review asks the user to answer.
_Avoid_: gap, untracked (untracked time is deliberate, not pending)

**Win**:
One entry under "Today's wins" in a review.

**Improvement**:
One entry under "How I'll improve" in a review.

**Midnight card**:
The prompt that, once a day ends, asks for that day's wins and improvements (P98). Saved or skipped, a day isn't asked about again.
_Avoid_: reflection (only the table name), journal

**KPI**:
A user-defined daily number (e.g. "Calls made") recorded in the review and charted over time.
_Avoid_: metric, stat

### Interface

**Widget**:
The small always-on-top bar showing the current block's timer, today's productive time and either the workday % or the goal %, whichever the user chose. It only displays; Start, Stop and the block length live in the dashboard.
_Avoid_: overlay, HUD, timer window

**Prompt**:
A question Spyder puts to the user (account for blocks, start reminder). Only one is shown at a time; the rest wait in a queue.
_Avoid_: popup, dialog, notification

**Dashboard**:
The main window with the Today, Week, Month, Review, Rules and Settings pages.
_Avoid_: app window, main screen
