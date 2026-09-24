# Changelog

What changed in each version, newest first.

Every line is marked with what it is: 🆕 something the app did not do before,
🎨 something it already did, drawn, worded or done differently, 🐛 something
that was wrong. New first, then changed, then fixed.

## 1.13.0

Sign in with Todoist, settings that follow you without a task in your Inbox,
a sturdier sync, and undo that really undoes.

🆕 **Continue with Todoist.** Connecting no longer means finding and pasting
an API token: one button, Todoist's consent page, and back connected. The app
now appears in Todoist's integrations, where it can be removed. Access renews
itself every hour without asking again. The token route is still there,
folded under "Use an API token instead". No server is involved: the app
identifies itself with a small public file (`oauth/client.json`) and protects
the round trip with PKCE.

🆕 **Deleting can be undone for real.** A deleted task leaves the screen at
once, but the deletion is only sent when its toast goes, eight seconds later.
Undo inside that window gives back the very same task — its link, comments,
reminders and assignee. Undoing later (⌘Z reaches further back) brings back a
copy, now with its comments, duration and assignee, and says it is a copy.

🆕 **A selection moves and completes as one.** Dragging one task of a
selection onto a project, section, day or tag carries the whole selection.
`E` on a selection completes it in one request, and a single ⌘Z reopens it
all.

🎨 **Settings live in a comment on your Inbox, not in a task.** They still
follow your account to every browser — now including the accent, the theme
and the density, and each project's list or board, grouping, sort, subtasks
and completed tasks — but no longer count in the Inbox, show in search or get
in the way of an empty Inbox. The old settings task is moved over and removed
automatically, and duplicate comments are cleaned up.

🎨 **Order follows Todoist's new `order_key`.** Tasks, sections, projects and
tags sort by the key Todoist now writes, so an order set in Todoist's own apps
shows the same here. Moving a task, a section or placing a new project writes
one key instead of renumbering every neighbour.

🎨 **Insights in a calmer palette.** Charts use a neutral data colour, and
only the best day and hour take the accent, so a good week no longer looks
like an alert.

🎨 **One name for the token** on the connect screen: "API token" /
"jeton d'API", as Todoist calls it. No "Add task" line under Behind schedule,
where a new task could never stay.

🎨 **Faster Insights.** Completed tasks are fetched three months at a time
instead of six weeks: a year takes five requests instead of nine.

🎨 **A Content-Security-Policy.** The site now tells the browser to run only
its own scripts and to talk only to Todoist, plus the usual hardening headers.
The theme is painted before the first frame by a small file rather than an
inline script. (Needs the new `.htaccess`.)

🐛 **Long pages scroll to their end.** The app's layout grew to the height of
the sidebar, and the bottom of every long page — and of the sidebar — was cut
off, only showing during the trackpad's bounce.

🐛 **Nothing lost offline.** Changes past the hundredth in the offline queue
were silently dropped; everything is now sent, in order. Tasks, projects and
sections created offline no longer appear twice after reconnecting, and
subtasks follow their new parent. A batch Todoist partly refuses keeps what it
accepted and says how much was saved.

🐛 **Sections can be created again.** Todoist started refusing a section with
an empty name; a new one is now named "Untitled section", selected for typing
over.

🐛 **Undo that goes back where things were.** Undoing a bulk move puts tasks
back in their section and under their parent. A quick ⌘Z after ticking a task
undoes that task, not whatever came before.

🐛 **No full reload after a recurring task.** Ticking or skipping a recurring
task used to download the whole account again; the answer to the tick already
carries the next date.

🐛 **Sync can't get stuck.** A request that never answers is given up after 20
seconds (a minute for the first full read) and treated as being offline,
instead of leaving the app on "syncing" until a reload.

🐛 **Phone rows are clean.** The swipe buttons no longer peek out along the
right of every row in the coloured groups.

## 1.12.1

A small follow-up to simplify where the cross-device settings marker lives.

🎨 **The settings task now lives in Inbox.** Enhanced no longer creates a
dedicated project for `* Enhanced for Todoist settings`. If the marker already
exists in another project, the next settings sync moves it to Inbox; an old
project left empty is not deleted automatically.

## 1.12.0

A safer recurring-task engine, cross-device settings, complete onboarding and
the interaction and layout fixes validated across issues 48–56.

🆕 **Settings follow the account across devices.** Enhanced reads its
preferences from a dedicated Todoist project when one exists, creates it when
needed, and updates the formatted settings task after every change without
putting it in Inbox or triggering Inbox automations.

🆕 **Bulk editing that understands recurrence.** Mixed selections can advance
each recurring task to its own next occurrence while leaving one-off tasks
alone, with the date shortcuts kept visible before the full date picker.

🆕 **A complete first-run tour.** The walkthrough always uses a safe demo
snapshot, so folders, project icons, quick tasks, subtasks, estimates and the
review are all shown even when the connected account does not contain them.

🎨 **A simpler choice for Today and My Week.** Choose either one combined My
Week page or separate Today + My Week pages. The obsolete duplicated-today
variant migrates automatically.

🎨 **Settings and onboarding refinement.** The long settings page scrolls to
its end, the account karma reads as progress, and the lighter coffee prompt
lives only in Settings with the maintainer's photo, a borderless card, clearer
copy and a visible close button.

🎨 **Consistent page measures.** List headers keep the same width across
projects, tags, views and the Eisenhower Matrix; boards and matrices alone may
use the wider content area.

🐛 **Recurring tasks advance instead of becoming stuck completed.** Completing
or skipping now uses Todoist's recurrence-aware close operation and lets
Todoist calculate the next date, eliminating tasks that bounced from tomorrow
back to today or yesterday, duplicated, or remained checked and unclickable.

🐛 **Keyboard bulk deletion works after modified clicks.** Cmd/Ctrl-click keeps
the selected row focused, restoring Cmd/Ctrl+Backspace without selecting page
text.

🐛 **Keyboard completion respects a selection.** Pressing `E` with several
tasks selected completes every selected task instead of only the focused row.

## 1.11.0

A searchable icon for every project, a workspace filter wherever more than
one project is in view, and a handful of smaller fixes from testing on
localhost.

🆕 **Lucide icons throughout.** The hand-drawn glyph sprite is replaced by
the Lucide icon set (MIT, lucide.dev) behind the same `Icon` component —
nothing that used it had to change.

🆕 **A picker for a project's own icon.** Choose from close to 300
searchable icons instead of the default "#" marker, from either the create
or the edit sheet, with the keyboard as well as the mouse. The choice is
saved as a hidden marker on the end of the project's own description, so it
is real, synced Todoist data rather than something only this browser
remembers.

🆕 **A workspace filter, wherever more than one project is in view.**
Today, Upcoming, Someday, Inbox, Tags, This Week and the Eisenhower Matrix
can each be narrowed to "My projects" or to one added workspace. A single
project's own page never offers it — every task there already shares that
project's one workspace.

🆕 **Show a project's completed tasks.** A Display toggle folds them back
into whichever grouping is already active — a section, a priority column —
sunk to the bottom of it, rather than pulled into a list of their own.

🆕 **Skip a recurring task's next occurrence from its own panel.** Was only
reachable from the row before; the task detail view's own date field offers
it too now.

🎨 **A subtask, edited in place.** Click a committed subtask in the composer
to fix a typo, instead of deleting it and retyping the whole thing.

🎨 **Completing a task from its own open panel shows it.** The checkbox
fills and the title strikes through immediately, the same as every list row
already did.

🎨 **Sort by date created, in either direction.** Newest-first and
oldest-first are now two separate choices, the way the estimate sort's
shortest- and longest-first already were.

🐛 **A row's own date field stops repeating "Today."** Next to the Today /
Tomorrow / Next week shortcuts it now always reads as a plain "Choose a
date" instead of echoing the same relative name a second time.

## 1.10.0

A calmer Insights dashboard, faster subtask editing, and more reliable nested
project navigation.

🆕 **Edit or delete subtasks in task detail.** Rename a subtask inline, cancel
with Escape, or delete it with confirmation without leaving its parent task.

🎨 **Insights put the comparison first.** Completed tasks, tasks per day,
completed estimated time, and focus score share a four-card summary with
previous-period changes. Activity charts show only the selected period and
identify the busiest day and hour. Project and tag breakdowns sit side by side
with matching donut spacing; the heatmap appears from a quarter onward.

🎨 **Empty parent projects read like folders.** A project with children but no
tasks of its own uses the same folder marker and right-side disclosure as a
Todoist folder, while its project page remains accessible.

🐛 **Uncompletable tasks stay uncompletable.** The Todoist `* ` marker remains
in stored content but no longer appears in list titles; completion is also
guarded at the action level, not just by hiding the checkbox.

🐛 **Nested projects can move to first place in either direction.** Dropping a
child on the seam above its first sibling now reorders within that parent,
including when the pointer lands on the parent's row.

## 1.9.0

A configurable decision view, clearer Insights, and more dependable navigation
and ordering. Developed locally and reviewed in demo mode before release.

🆕 **Eisenhower Matrix.** Enable the optional sidebar view in Settings, then
choose List or Matrix in Display. The Display menu independently controls which
tasks are shown, which date or week buckets count as urgent, and which Todoist
priorities count as important. By default, overdue and today are urgent, P1/P2
are important, anytime-this-week remains visible but not urgent, and future
dates and the Someday backlog are hidden. Classification never edits a task.

🆕 **Sections in global search.** An optional setting includes accent-insensitive
section matches with their parent project. Choosing one opens and highlights
that section; the route survives a reload.

🎨 **Insights are easier to read.** The dashboard presents completed tasks,
average tasks per day, and completed estimated time without repeating the same
headline. It adds a day/month trend choice where useful, time-of-day, project,
priority and focus, top tags, and a full-year activity heatmap with a legend.

🐛 **Shift-click selects a visible range of tasks.** Command-click still
toggles individual tasks, while Command-Shift-click adds a range to the
existing selection.

🐛 **Sidebar project and section ordering is precise.** Project rows use
before/after insertion, rightward nesting and leftward outdenting. Reordering
stays within one sibling list and workspace, with a visible insertion line.
Section drops now read their insertion slots correctly.

## 1.8.1

A corrective pass over the task and bulk-edit pickers introduced in 1.8.0,
with consistent project, section, date and tag behaviour everywhere they
appear.

🆕 **Bulk move includes sections.** Projects and their sections now share the
same searchable destination list used when moving a single task. A section can
be found by either its own name or its project's name, and moving several tasks
there is one change with one undo.

🎨 **Bulk destination lists stay compact without browser scrollbars.** Six
rows are visible, further results remain reachable with a wheel or trackpad,
and typing filters the list. The panel has a stable width, hides its vertical
scrollbar and cannot drift sideways; long names are truncated rather than
creating horizontal scrolling.

🎨 **The Tags page has one clear creation control.** The duplicate Add tag
button in the page header is gone, while the inline name field remains where
the new tag will appear. Bulk tag selection also drops its unnecessary helper
sentence.

🐛 **Project selection stays open in a task.** Scrolling the selected option
into view was mistaken for a page scroll and immediately dismissed the
project picker. The picker now remains available for searching and choosing.

🐛 **Bulk dates take the keyboard on the first click.** Opening Date now opens
and focuses the natural-language date field immediately, so typing no longer
falls through to the app-wide search.

🐛 **Tags can be reordered all the way to the top.** A dedicated first
insertion point accepts a dragged tag, and every destination displays the same
accent line used for project reordering.

## 1.8.0

The controls now answer the keyboard wherever a value is chosen, and boards
show the grouping their Display menu promises.

🆕 **Type into dates, projects and tags.** Every date calendar starts with the
same natural-language field used on a task row, so `tomorrow`, `next Sunday`
and `12 April` work in the composer, task panel, bulk bar and Insights. Long
project and section lists filter as you type. Tag pickers do the same, with
Enter toggling the first match without closing a multi-select list.

🆕 **Sort tasks by the order of the Tags list.** A task with several tags uses
the highest one in that list as its sort key, internal estimate labels do not
count, and untagged work stays at the end. Grouping is deliberately different:
a task with two tags remains visible under both of them.

🎨 **A project board honours its grouping.** The ordinary board still uses
sections. Choosing scheduled, priority, tag, estimate or day now makes those
values the columns instead, and adding in an unambiguous column pre-fills its
date, priority or tag.

🐛 **Equal priorities have a stable, meaningful order.** Inside one project
they retain its hand-made task order. Across projects they use the view's
global day order, then a stable creation/id fallback, rather than comparing
unrelated per-project positions.

## 1.7.1

A pass over what 1.7.0 got wrong, and the small things it made obvious.

🆕 **Drag a project or a tag into Favourites.** Drop either on the section and
it becomes one. The sidebar teaches dragging all day — a project is reordered
by it and nested by it — so dragging one into the section it plainly belongs
in was the first thing to try and the one thing that did nothing. A project
and a tag are also carried under the pointer now, the way a task always was.

🆕 **Add a task from a column that knows something about it.** A project
grouped by priority had no way to add a task at all, on the one page where
both halves of the answer are known. A column offers the line when its own
heading fixes something the composer can be opened with, and fills in exactly
that: a P2 column in a project fills the project and the priority, a P2 column
in My week fills the priority and nothing else.

🎨 **The row under the keyboard cursor and a row you have picked look the
same.** They were a grey and an accent tint — two ideas rather than two ways
of saying one. There is one mark for "this row" now, mixed from whichever
accent is set.

🎨 **On a phone, Display and Insights are in the same place on every page.**
They used to sit beside the title when the title was short enough to allow it
and wrap to their own line when it was not, so their position depended on
which page you were on.

🐛 **The cursor no longer turns white under the mouse pointer.** Hover and the
cursor were written in different files at the same weight, so the one you saw
depended on the order the stylesheets happened to load in.

🐛 **A delete can be confirmed from the keyboard.** The confirming button asked
for the focus and did not get it, so Enter pressed Cancel — every time, with
no way through the dialog at all. Cmd+Enter now confirms wherever the focus
is, and Cmd+Backspace over a selection deletes the selection rather than the
one row under the cursor.

🐛 **"Add task" in Anytime this week makes a task that is in the week.** It
opened an empty composer, so the task went to Someday — out of the section it
was added from. Quick had the same gap and forgot the tag it is defined by.

🐛 **The Display menu fits on a phone.** 320px hung from the right edge of its
button is 320px going left, and half of it was off the screen.

🐛 **A destination no longer offers to take something it cannot.** A tag
carried over a project row lit up as though it would file itself there, and
there is no such thing as a tag on a project.

## 1.7.0

Every list opens in the order that answers "what now", the keyboard reaches
everything the mouse can, and a phone gets the two gestures it has instead of
a pointer.

🆕 **Move, open and delete a task without the mouse.** Arrows — or J and K —
walk the tasks of whatever page is open, Enter opens one, Escape gives the
cursor back. On the task under the cursor: E finishes it, T schedules it and
Shift+T takes the date off, V moves it, X adds it to the selection, 1 to 4 set
the priority, `.` opens the rest, and Cmd+Backspace deletes it — still asking
first, because deleting is the one thing that should never be one keystroke
away from done. The keys are Todoist's own, from Todoist's published list;
where Todoist has no equivalent, nothing was invented.

🆕 **Typing goes to the search.** Start typing on a page with no task under
the cursor and the search takes it, with the first letter already in the field.
The search already reaches projects, sections, tags and views, which makes it
the way to a project without a mouse. Letters are commands when the cursor is
on a task and text when it is not — one sentence covering every key.

🆕 **G, then where to.** G then W, T, U, S, I, R, L, A, or a comma for
Settings. A prefix rather than a letter each, so the alphabet stays free for
typing. The sidebar says which key gets to a row once the pointer has rested on
it, and `?` shows the whole list.

🆕 **An opened task answers the keyboard.** P opens the project, T the start
date, D the deadline, E the estimate, Y the priority, L the tags — each letter
shown, faintly, beside the property it opens. Tab stays inside the panel, the
overflow menu takes arrow keys, and Escape closes the innermost thing that is
open rather than the outermost.

🆕 **Swipe a task aside on a phone.** The row slides and shows what hovering
would have shown on a desktop: estimate, schedule, move, and the rest. Holding
a row opens the same actions as a sheet with their names on. A phone has no
pointer to reveal anything with, and the answer until now had been to take the
controls away.

🆕 **An estimate is a row of durations on a phone.** Five minutes to two
hours, with the field underneath for anything else — typing "45" on a phone
means opening a keyboard over half the screen to press two keys.

🎨 **A view opens sorted by priority.** Manual order is whatever order things
were added in, which puts a p1 below three p4s on a page opened to decide what
to do next. Projects open grouped by their own sections, a backlog and a tag
page by project. Dropping a task into a place is what makes a view manual
again — and the order written down is the order that was on the screen, so the
page the sort leaves behind is the page you were looking at.

🎨 **The undo toast says what the drop did.** "Moved to Thursday", "Moved to
#Website", "Became a subtask of Prepare the kick-off meeting". Every drop used
to read the same, which is no use at all when a drop landing a few pixels off
does something different from what was meant.

🎨 **Insights picks its range with the app's own calendar.** The one control
the rest of the app refuses to use is gone from the last place it was hiding.
Days outside the range are drawn and greyed rather than hidden.

🎨 **Someday is in the phone's navigation bar.** Browse was there and in the
bar at the top of every page; it stays at the top, and the slot it gives up
goes to a destination that was two taps away behind it.

🎨 **The first run asks one question on a phone.** Light or dark. Three grids
of cards at 375px is a page and a half of scrolling before anyone has seen a
task, and the other two choices are a pleasure to find later in Settings.

🐛 **Row menus open upwards when there is no room below them.** The foot of a
list is where the work nobody has dealt with sits, which is exactly the work
you want to reschedule.

🐛 **A task ticked off in the daily review leaves the way it does everywhere
else.** It was being kept and marked instead of going, which made the review
the one place where finishing a task looked like something else.

🐛 **Scrolling the sidebar with a finger no longer carries a project off.** A
drag starts on distance with a mouse and on time with a finger: move before the
press is held and it was a scroll.

🐛 **Connecting no longer leaves the app zoomed in on iOS.** Safari zooms the
page when a field smaller than 16px takes the caret, and does not zoom back.

🐛 **Adding a task with Cmd+Enter created it twice.** The name field answered
the keystroke and so did the sheet.

🐛 **Escape in a description or an estimate saves and leaves the field**,
rather than discarding the edit and closing the task behind it.

## 1.6.0

Dragging a task says three things instead of one, a list can be put in the
order you want it in, and where a task lives is asked once.

🆕 **A task can be put inside another one.** Drag a row a little to the
right over another and an indented line says it will land inside it — the same
line, in the same place, that the sidebar draws when a project is about to go
inside another. Todoist keeps four levels of subtasks, so a row that would push
a task past that simply does not take the drop. Board cards are left alone:
they get dragged sideways all day and a drift to the right there means nothing.

🆕 **And taken back out.** Drag a subtask out to the left and it becomes
a task of its own, where it already lives. The row's menu offers the same thing
in words, because a gesture nobody has been told about is not a way out of
anything.

🆕 **A list can be put in the order you want it in.** Drop a task
straight onto a row and it takes that row's place. In a project and in the
Inbox that is Todoist's own numbering inside a project. In My week, Upcoming,
a tag page and Un jour — lists drawn from every project at once, where that
numbering cannot say anything — it is `day_order`, the number Todoist keeps for
exactly those lists and reads in its own Today view. Either way the order is in
Todoist, not in a corner of this app that only this browser can see. A task
dragged into a list from another group gets both things at once: the day, or
the tag, and the place in it.

🆕 **"Add task" stands where a task would go.** At the end of every
section, at the top of a project above its first section, at the foot of every
board column, and on the Inbox, Un jour and tag pages. It used to appear only
under the pointer, at the same moment as the "add section" line below it, so
the two traded places as you moved. A column offers it when the column is a
place: a project column adds to that project, a tag column adds with that tag.
On a tag page it opens with the tag already on.

🆕 **A project and its sections are one field.** Creating a task asked
for a project and then grew a second field for a section belonging to it — two
decisions for one question. One list now, sections indented under the project
they are in, exactly as the row's move menu has always shown them. The task
panel has the same field, where the section could not be set at all.

🎨 **A board takes the whole page.** It used to stop at the width a
paragraph is read in and scroll sideways with empty space on both sides. The
columns take their share of it too, between 272 and 420 pixels, so three
sections fill a laptop instead of huddling on the left. What is read above the
board — the title, the figures, the controls — keeps the measure and the
position it has on every other page.

🎨 **The preview under the pointer is a card.** It had no style of its
own at all: sixteen-pixel text as wide as the page, floating on nothing.

🎨 **The drag handle lines up with the checkbox** rather than with the
middle of the row, so a task with a description no longer holds its handle
somewhere below its own title.

🐛 **The task panel really moves a task.** Its project picker wrote
`project_id` through `item_update`, which takes neither a project nor a section
— only `item_move` does. The task moved on screen and stayed where it was on
Todoist until the next sync put it back. A move now settles what it does not
carry: a task sent to a project leaves the section it was in, a task sent to a
section joins that section's project.

🐛 **The sort on the Inbox, Un jour and a tag page does something.**
Those pages are drawn without the part of the app that sorts, so the control in
their Display menu had never once changed the order of anything.

🐛 **The count on Display can be read in the dark theme.** It was white
on `--text`, which is nearly white there. So was the toast, undo button
included — the one thing in the app you have to be able to read in a hurry.

## 1.5.0

Reading a task's name: a guess you can turn down, an hour you can name, and a
title that does all of it too.

🆕 **A reading can be refused, one occurrence at a time.** "Weekly review
tous les lundi" had its first word read as a repeat rule — a fair guess and
the wrong one, and until now the only way to say so was to rename the task
until the parser stopped seeing it. Clicking a mark, or pressing Backspace
against it, turns those words back into ordinary text and takes the value out
of the field it had filled; clicking them again brings the reading back. It
refuses that one occurrence and no other, so "Weekly review weekly" can keep
its title and still repeat.

🆕 **A name can say the section as well as the project.** `#Project/Section`
fills both, and typing `/` after a project turns the list into that project's
sections — all of them, whether or not their names have anything to do with
what was typed, because naming the project is asking to be shown where inside
it the task could go.

🆕 **A time of day, in words or in figures.** "demain 12:14" is tomorrow at
12:14; "demain matin" is nine, "demain soir" is seven, and "ce soir" is today
at seven. The hours are Todoist's own, so the same words typed here and there
land on the same minute.

🆕 **A task's title reads what the composer reads.** Editing it recognises a
date, a repeat, a project, a section, a tag, a priority and an estimate, marks
them as you type, and writes them to their fields when the title is saved —
with Enter, or with the Save beside it. Escape puts the title back.

🆕 **Subtasks can be put in order**, by dragging them past each other in the
task panel.

🎨 **The marks are drawn in the colour of what they name.** A project's is
the project's colour, a tag's is the tag's, a priority's runs from P1 red to P4
grey. A date and a repeat wear the accent, because those two are guesses about
prose rather than something written on purpose — and they are the ones usually
worth refusing.

🎨 **The line above a task is a trail rather than a caption.** A subtask used
to be a dead end: the panel named its project and said nothing about the task
it belongs to, so closing was the only way back. Every ancestor is a link now,
the project included.

🎨 **A second project replaces the first.** A name carries one project, one
priority, one day: two of any of them is somebody changing their mind, so the
last one typed is the one that counts, and refusing it hands the reading back
to the one before. Tags are the exception — a task can carry several, so every
one of them is marked.

🐛 **A new subtask is drawn where it will end up.** It was created at the
top of its parent's list and jumped to the bottom when the sync answered.

🐛 **A drop lands where it was aimed.** Four different things are dragged in
this app and they all shared one context, so a region of the page behind the
task panel could win a drop meant for a row inside it. Each drag is now only
offered what it could possibly mean.

🐛 **The description keeps one height.** It was a fixed box that scrolled
while the rendered text below it was as tall as it needed to be, so clicking
away from a long description opened the panel under the pointer.

## 1.4.0

Sending a task where it belongs: a section by name, a project by drag, and the
project's own tasks where you left them.

🆕 **A task can be sent to a section, and found by typing.** The move menu
opened on a list of projects and nothing else, so a task that belonged in
"Site vitrine / In review" took a move and then a drag down the page. Sections
are destinations now, and the menu opens with the caret in a field: type any
part of the section's name or its project's, press Enter, and the first match
takes it. Choosing the project itself means the project with no section, which
is how a task comes back out of one.

🎨 **A project's own tasks come first, with no heading.** Tasks in no
section were collected at the foot of the page under "No section" — a
container nobody made, holding the loose, recent work where nobody looks. They
lead the page now, above the sections and unlabelled, which is how the board
has always shown them.

🐛 **A task dropped on a project in the sidebar lands there.** A sidebar
row is two things at once, somewhere to file a task and a position in a list,
and both readings stayed open during every drag: a task let go over a project
hit whichever one the collision happened to return first, drew the bar that
belongs to reordering, and went nowhere. Each reading now stands down for the
drag it has no answer for, so a project still reorders and a task still lands.

🐛 **Undoing a move from the row menu puts the task back.** The undo was
sent as an update, which carries neither a project nor a section, so it put the
task back on screen and left it where it had been sent on the server. It is
sent as a move now. The same menu also sent a section and a project together
to an API that takes exactly one destination.

## 1.3.0

Editing a selection by more than its date, a caret that stays where it was
put, and one quiet line about the coffee.

🆕 **A selection can be given more than a date.** The bar at the foot of the
window offered today, this week, someday and a date, which meant that taking
one tag off fifteen tasks was fifteen tasks opened one at a time. It carries
one button per property now — Date, Move, Tags, Priority — each with its icon
and its name, each opening its panel above the bar rather than below it, where
the foot of the window is. Every change is still one request and one undo.

🆕 **Tags in bulk, taken off as readily as put on.** A tag carried by some of
the selection shows as a half-tick rather than as "no": ticking it puts the
tag on the ones that are missing it, and clearing it takes the tag off all of
them. The selection survives a tag change, because dropping two tags is one
job; a move or a priority ends it.

🆕 **Escape gives the selection back.** A dialog and an open menu both stop
the key where they are, so it reaches the selection only when the selection is
the outermost thing left to dismiss.

🆕 **A line about the coffee, at the end of two things.** Faint, small, one
sentence and an offer, at the foot of a finished review and at the foot of
Insights. It counts nothing, no milestone triggers it, and it does not appear
more often the longer the app is used.

🐛 **A dialog stops taking the caret back.** Every caller passes a fresh
callback to the dialog shell on every render, and that callback sat in the
effect's dependency list — so any render of the page behind a dialog tore the
effect down and set it up again, handing focus back and then moving it to the
top of the sheet. One sync poll was enough. Typing a description, the caret
left mid-word; filling in Things to settle, it landed back in the first
estimate and the rest of the number went there.

🐛 **A sync no longer overwrites what is being typed.** The title, the
description and the estimate all re-seed themselves from the task. They now
refuse to do it while they hold the caret, so an update arriving mid-sentence
cannot replace a draft with the stored text.

## 1.2.1

🐛 **The app icon, actually.** 1.2.0 drew the icons correctly and put them in
`icons/`, and that folder has now been dropped by an upload twice — the second
time leaving a directory on the server that Apache could no longer read into,
so re-uploading could not repair it. Every icon still answered 404, so browsers
still refused to offer the install and an installed copy still had no icon of
its own. They live at the root of the site now, beside `favicon.svg` and
`og-image.png`, which have never once failed to arrive. Delete the old `icons/`
folder from the server; nothing points at it any more.

## 1.2.0

Dark mode, a colour of your own, and recurring dates the app can finally
read as well as show.

🆕 **A dark theme.** Appearance sits under General and offers Automatic,
Light and Dark. It follows the device by default and switches along with it
mid-session, and the choice is remembered so the page never opens in the
wrong theme. Todoist's own project and tag colours are lightened on a dark
page rather than left at the 2:1 several of them fall to, so a board stays
recognisable in both.

🆕 **A colour of your own.** Nine accents — red, orange, amber, green, teal,
blue, indigo, purple, pink — and a tenth you pick yourself, shown as ten
small windows onto the app rather than ten colour names. A theme is nine
tokens rather than one hue, so a custom colour is put through the same
recipe the presets are generated by: the ink is walked up or down until it
clears the page, the wash and the badge. A custom colour cannot come out
illegible. Overdue and priority one stay red under every accent, because
they are states rather than the brand.

🆕 **Recurring dates, read and written.** Typing "appeler Marc every monday"
made a task called "appeler Marc every monday" with no date at all. The
composer marks a repeat rule now, the task panel's Récurrence line is a
field instead of a value you could see and not change, and the schedule
menu's date field reads one too. The grammar follows the list Todoist
publishes, in both languages, and refuses what it cannot vouch for rather
than guessing.

🆕 **A first run, once.** Connecting an account for the first time — or
opening the demo — asks three questions on one page: light or dark, which
colour, how much room a task gets. Each answer applies to the page behind
the dialog as you make it. It is then followed by a short tour that lights
up four things in the app itself rather than describing them. It is
remembered per Todoist account rather than per browser, so disconnecting and
reconnecting does not ask again, and Settings has a "Run it again".

🆕 **Someday, from the daily review's week step.** It offered Today and This
week, so the one thing you sometimes want to say — this is not happening
this week — had nowhere to go.

🎨 **Appearance and the week are shown rather than named**, the way density
already was, and the settings that open into a panel of cards no longer sit
flush against the next setting's label.

🐛 **A plain date no longer ends a recurring series.** `due.string` is what
Todoist treats as the truth, and four paths were writing a date into it
while leaving the task marked as repeating — including drag and drop, and
"Tout passer à aujourd'hui". They all put the rule back unchanged now and
move only the date. The time of day survives the schedule menu too.

🐛 **The app icon.** The 192 and 512 had their corners cut to transparency
with rounding already baked in, while being declared as icons shown whole —
so every surface that applies its own shape rounded them twice and left the
app's own corners inside the system's as a visible ring. All five are
full-bleed opaque squares now, drawn by `npm run icons`, and the maskable
pair is drawn small enough to clear an adaptive mask properly.

🐛 **The manifest has a media type**, via an `.htaccess` that ships with the
build. It was being served with no `Content-Type` header at all.

## 1.1.1

Everything reported after 1.1 went out, in three rounds of it.

🆕 **Today can have a page of its own.** My week still holds the whole week
by default, because deciding what today is means seeing what the week still
owes; a setting separates the two for anyone who would rather keep a page for
the day, with today left out of the week or still inside it.

🆕 **The tag that means "anytime this week" can be renamed.** Boards that
already say `this_week` no longer have to be relabelled to be read here.

🆕 **Undo, on the keyboard.** Cmd+Z (Ctrl+Z) reverses the last change — a
move, a completion, a deletion, a drop — not only while its toast is on
screen. A deleted task and its subtasks are written back; they return under
new ids, which is the one thing Todoist gives no way to preserve.

🆕 **Several tasks at once.** Cmd+click (Ctrl+click) picks rows out, and a
bar at the foot of the window sends the lot to today, to this week, to
Someday or to a date, or deletes them — one request, one undo.

🆕 **Projects nest in the sidebar.** Drag one to the right to put it inside
the row under the pointer, or onto a folder, where no sideways gesture is
needed because holding projects is the whole of what a folder is. The project
menu moves one back out.

🆕 **A task's date can be typed.** Its schedule menu opens on a field with
the caret already in it, and what you type narrows a short list underneath:
"to" offers today and tomorrow, "tom" only one of them, and a bare "15"
offers the next three fifteenths with the weekday each falls on. A calendar
sits under the three shortcuts for the dates easier to point at than to name.

🆕 **The composer reads an estimate out of a name**, written in brackets:
"Call Anne (25)".

🆕 **A date format setting** — 12 sept. 2026, sept. 12, 2026, 2026 sept. 12,
or all numbers. Today and tomorrow are always named rather than dated,
wherever a date is shown.

🆕 **The weekly review reads a week you choose.** It read the week in
progress and nothing else, which only works for somebody doing it on a Sunday
night; done on a Monday it read a week two hours old. It opens on the week
that has just ended while the new one is young, and arrows reach the ones
before.

🆕 **The weekly review closes the week and then opens the next one**: what
you finished, what it came to, what is late, which projects went quiet — then
mail, inbox, Someday, this week's commitments, estimates, and what the week
weighs. It used to end on Someday, the longest and least engaging list in the
app, placed exactly where people stop, and then claim the next week was ready
when nothing had set it up.

🆕 **Both passes end on the load**, the idea the whole product is built on
and the one thing the ritual meant to steer it never mentioned: the day's
hours or the week's, against the hours you said you have, with each task
offering a way out on the spot.

🆕 **A mail step in both passes**, immediately before the inbox, because a
good part of what is sitting in the inbox arrived as an email and filing the
inbox first files half of it. It claims nothing it cannot know — this app
cannot see your mail — and carries links to where the mail actually is.

🆕 **The last step of the daily pass has somewhere to send things.** It
offered no action at all, so a day that was already full ended the review on
a problem with nowhere to put it.

🆕 **How long a project may go quiet is a setting.** Fourteen days is a fair
default and a poor constant: on a fast board it is permanent noise, on a slow
one the warning never comes.

🎨 **Things to settle says what it holds.** It was an icon with a dot on it,
equally quiet whether it held nothing or fourteen contradictions. When there
is something in it, it takes a line and the wash the Behind schedule section
uses — read at rest, without competing with Add task.

🎨 **A task ticked off leans out rather than vanishing** under the pointer,
which had made a mis-click indistinguishable from a correct one. The tick
lands, the text greys, and the row leaves a beat later.

🎨 **The words the composer marks in a name have air around them**, taken as
padding and given back as a negative margin so the marks line up with the
text in front of them and the ordinary spaces of the sentence keep their
ordinary width.

🎨 **The buttons that appear over a board card have an edge.** They were a
white panel on a white card, which is nothing at all.

🎨 **A picked-out row is a grey panel** wider than the row, so the checkbox
sits inside it rather than on its edge, and nothing on the row moves when it
is picked.

🎨 **The line that says a project will be nested** is the width and the
indentation the nested row itself will have.

🎨 **The review's rail says where you are, and nothing else.** It used to
colour each step by how much was in it, so the rail changed meaning as you
answered it and a count of finished tasks sat in the same circle as a count
of things still to settle — Someday showed a ticked pill reading "142".
Behind you, where you are, still to come: three states, one colour. Steps
that hand you something to read carry a mark rather than a tally.

🎨 **The review's cadence control stopped moving.** Switching between daily
and weekly changed the head's layout and took the button you had just pressed
somewhere else; the week pager now sits beside it on the same line.

🐛 **What the composer read out of a name never reached the fields below
it.** Typing "Friday #Work p1" marked those words and left the date, project
and priority pickers showing something else, so the dialog could hold two
different tasks at once and only one of them was going to be created. The
name and the fields are now one reading, made once.

🐛 **Search only found tasks once you typed.** The list of places it offered
on opening was thrown away at the first keystroke, so typing "settings" — the
fastest way anybody would try to reach settings — found tasks with the word
in them and nothing else. Destinations are searched too, accents set aside,
and come first.

🐛 **"Show subtasks" did nothing.** The switch was drawn, stored and read by
nobody.

🐛 **Adding to the home screen on an iPhone gave a red tile with an E on
it.** iOS does not read the web manifest; it needs its own icon, and now has
one. The manifest also declares an identity and a full set of maskable icons,
which is what a desktop browser wants before it offers to install anything.

🐛 **The "no estimate" tab of Things to settle could only be read.** It now
holds the same batch editor the page header opens, instead of a weaker copy
of it.

🐛 **The review's estimates step emptied itself under your hands.** It wrote
one request per task, so the row you were typing in left the list the moment
you pressed Enter and the next jumped under the cursor. It holds its answers
now: the list stays still, the total gathers at the foot, one request at the
end.

🐛 **"Slipped" and "Behind schedule" were the same question** asked twice
under two names. There is one now.

🐛 **Giving a task a date from a row or a column left the week tag on it**,
where dropping it on Today had always taken it off — the two together are the
contradiction the app reports rather than resolves.

## 1.1.0

🆕 **Daily and weekly review.** One question at a time, in an order, with an
end. The daily pass asks what is late, what is sitting in the Inbox with no
project, what you committed to this week without naming a day, what has no
estimate, and what today holds. The weekly pass asks what you finished, what
the week amounted to in numbers, what slipped, what is unfiled, what has no
estimate, which projects have gone quiet, and what is parked in Someday.
Every answer is a change Todoist already understands, made through the same
rules a drag makes. The review stores nothing of its own.

🆕 **Project actions**, the ones Todoist gives them, from the sidebar row and
from the project's own page: add a project above or below, edit, favourite,
duplicate, archive, delete. A project also renames from its own title.

🆕 **Projects reorder by dragging** them in the sidebar, within their own
list of siblings.

🆕 **Tags can be created** — from the Tags page, or by typing a name after
`@` that does not exist yet.

🆕 **A density setting**, chosen by looking at two pictures rather than by
reading two adjectives. Compact closes the space around a row without taking
anything out of it: the same type, the same fields, a shorter page.

🆕 **Browse**, a fifth destination on the phone, holding everything a phone
has no room for: the profile and its menu, search, tags, favourites,
projects. It is the sidebar rendered as a page, not a second list kept in
step by hand.

🆕 The app's **own date picker and own select**, everywhere a task is made or
edited. No operating-system list opening inside a sheet this app drew.

🆕 Filling in a page's missing estimates is **one pass and one request**: Tab
walks the column, the foot counts what is filled and what it adds up to, and
one button saves the lot.

🆕 The user menu gained the feedback form and the coffee link, and closes
when you click away from it.

🎨 Tags carry their colour onto the task row.

🎨 Insights reads a year of history four windows at a time instead of one
after another.

🎨 Sending a task to a destination is one method in one place, rather than
the same fifteen lines written out wherever it was needed.

🐛 **Every toast in the product was invisible.** A leftover rule held them at
zero opacity waiting for a class nothing ever added, so no error and no undo
had ever reached anyone. This is why a refused change looked like a change
that never registered the click.

🐛 **Adding a task from the composer could create nothing at all.** Leaving
the project picker alone sent an empty project id, which Todoist refuses. The
Inbox was listed twice: once as that empty value, and once as the real
project it already is.

🐛 **A refusal is now reported rather than swallowed**, and the refused
command is dropped instead of going out again on every sync for ever — where
it also took everything queued behind it down with it.

🐛 **A 403 is no longer read as a bad token.** Todoist also answers 403 when
a command is against the rules of a plan, and reading that as an auth failure
hid the real reason and signed people out over it.

🐛 **A project nested under another project was never drawn** in the sidebar.
Only folders disclosed their children.

🐛 **A description with two links showed raw HTML.** The inline renderer ran
emphasis over a string that already carried generated anchors, so the
underscore in one `target="_blank"` paired with the next and tore both tags
in half.

🐛 The phone's navigation bar sat below the fold, behind the browser's own
furniture and anything above it in the app. It is fixed to the window and
padded for the phone's hardware.

🐛 The "open navigation" button on a phone opened My week. The "hide sidebar"
button did nothing at all; there is no column beside the app to hide.

🐛 A new section or tag could appear twice: only tasks and projects had their
placeholder cleared when the real record came back.

## 1.0.0

🆕 The insights period can be stepped with arrows: this week, then the week
before it. The presets are calendar units, so a week starts on the day the
Todoist account does and the quarter is the calendar quarter. Either date
can be edited to make a range of your own.

🆕 Tags can be dragged into a new order on the Tags page. The order is
Todoist's own, so the sidebar's favourites follow it.

🆕 A board with more columns than fit scrolls sideways, with arrows above it.

🆕 A link to the app unfurls with a title, a description and a picture of My
week.

🆕 An About section in settings, carrying the version, the statement that
this is not an official Todoist product, and links to the site, the code,
this changelog and the coffee.

🎨 The app is named "Enhanced for Todoist" everywhere, which is the form
Todoist's brand guidelines ask of a third-party app, and every description of
it now states that it is not created by, affiliated with, or supported by
Todoist.

🎨 The icon is the app's own: three capsules of different heights on one
baseline, a week read as the load it carries. It replaces Todoist's mark,
which a project that is not theirs had no business wearing. The browser and
install colour is the app's own accent rather than Todoist's red.

🎨 A task tagged quick but estimated at more than five minutes is left out of
the Quick group. The tag is a claim and the estimate is the fact.

🎨 The add-task line at the end of a section takes no room until the section
is hovered, and unfolds rather than appearing. Behind schedule and Quick no
longer carry an empty band under their last row.

🎨 On a project board, tasks outside any section are the first column.

🎨 Tags are listed one per row.

🎨 The logbook grouped by priority reads P1 first.

🎨 Upcoming's board uses the same arrows as every other board.

🐛 My week in board mode showed one column holding the whole week. It shows
the same five buckets the list does.

🐛 A profile photo in the sidebar kept its own square corners on top of the
round frame, and a portrait that was not square was squashed into it.

🐛 Installed on a phone, the icon has a full-bleed version of its own, so the
system's mask no longer eats its rounded corners.

🐛 Behind schedule no longer accepts drops. Dropping there dated the task
today, which is not what the heading says.

## 0.9.0

🆕 Dropping a task on the Quick group dates it today and adds the quick tag.

🆕 A board column shows its estimated time, how many of its tasks have no
estimate and, for a day column, how full it is against that day's capacity.

🎨 The separate dashboard page is gone. Its charts are the Dashboard tab of
the insights page, and an old `#/dashboard` link lands there.

🎨 Board columns use the same width as the list.

🎨 Tasks on a board are laid out as cards rather than as list rows.

🐛 The click a browser fires at the end of a drag no longer opens the task
that was dropped.

## 0.8.1

🎨 A project's description is always visible as a single line. Hovering it
opens a panel with the full text, where links can be clicked.

🐛 The capacity grid in settings had lost its layout and its inputs ran off
the page.

🐛 Selects in settings could not shrink below their content.

🐛 Page controls wrap under the title in a narrow column instead of
overflowing.

🐛 A chart with two dozen marks scrolls inside its own card.

## 0.8.0

🆕 Sections can be reordered by dragging them, with their tasks, into the gap
between two other sections. The gaps open up while a section is being
dragged so they can actually be hit.

🆕 Sections can be deleted. The confirmation says how many tasks go with the
section.

🎨 The app uses Todoist's icon.

🎨 Calendar mode is removed from every view.

🎨 Section descriptions are removed.

🎨 A section's name field is sized to its own text instead of filling the
row, so the duration and the count sit next to the name.

🎨 A project with no description takes no vertical space until the header is
hovered, which closed a 52px gap between the title and the figures below it.

🐛 A new build takes effect on the next reload. The service worker used to
keep serving the old one until every tab had been closed, which made fixes
look like they had not been applied.

🐛 A new section is created where you clicked rather than at the bottom.

🐛 Dragging a task onto Today also highlighted the Behind schedule and Quick
sections, because sections offering the same destination shared one
identifier.

## 0.7.0

🐛 Drop targets in the sidebar stopped working whenever the page offered the
same destination, because two drop targets cannot share an identifier. A
favourite project also shadowed its own row under the workspace.

🐛 The drop indicator was drawn outside the element, so the sidebar's scroll
container cut off its left and right edges.

🐛 Board columns were forced four across and squeezed to 157px, which left
task titles unreadable. The board sizes its own columns again.

🐛 Collapsing a section only worked on the heading text, not on the space
between it and the rule underneath.

🐛 The project description rendered a `div` inside a `p`.

## 0.6.0

🆕 Dates are read from the task name as you type: `tomorrow`, `lundi`,
`in 3 days`, `10 sept`, `demain à 9h`. What was recognised is highlighted in
the field before the task is saved, and the whole thing can be switched off
in settings. `#project`, `p1` and `@tag` always apply.

🆕 Subtasks can be typed in the add-task dialog and are created with the
parent.

🆕 Search is usable from the keyboard: arrows move through the results, Enter
opens one.

🆕 Multi-select filters in the logbook.

🆕 Upcoming shows four day columns at a time, with arrows to move between
them.

🎨 The insights dashboard follows the period. A day shows the hours work
happened in; a week or month adds the week's shape and a day-by-day
comparison; a quarter reads by week and a year by month.

🎨 Tags use a tag icon instead of a flag.

🎨 The Insights button is white. Filled red read as a selected state.

🎨 The drag preview sits beside the pointer so the cursor stays visible.

🎨 The Insights overview tab is called Dashboard, and the tab is part of the
URL.

🐛 Board columns wrap onto a second row instead of running off the page.
Grouped by project or tag, most of the board had been off-screen.

🐛 Cards sharing a row share a height.

🐛 The tag picker grew the dialog and scrolled the fields out of view.

🐛 The project description was given the full width of the header.

## 0.5.0

🆕 Project and priority shown as ring charts, tasks per day, time of day, a
tag ranking, and a comparison against the previous period.

🆕 A homepage setting.

🎨 The interface follows the design file: a warm red palette with one role
per shade, a pink-tinted sidebar, and a 10px control radius.

🎨 The sign-in screen matches the design, with the privacy note between the
field and the button.

🎨 The dashboard shows charts and figures only. The task list that used to
sit in the middle of it belonged in a view.

🎨 Settings is one page you scroll, with a menu that tracks your position.

🎨 Every select is drawn by the app rather than by the operating system.

🐛 Hover controls sat in the middle of a task row because the grid reserved a
column that nothing filled.

🐛 Dropping a task on Inbox, Upcoming or Someday did nothing.

🐛 The estimate field in the task panel had no unit beside it.

🐛 The repeat, flag, stack and group icons were drawn incorrectly.

## 0.1.0

First working version.

🆕 My week as the home view, splitting the week into behind schedule, quick,
today, scheduled today and anytime this week.

🆕 Estimates stored as the label `est-<minutes>` and shown as durations, with
workload and capacity calculated from them.

🆕 Upcoming, Someday, Inbox, project pages and tag pages.

🆕 List, board and focus modes.

🆕 Drag and drop with one meaning per destination, every drop undoable.

🆕 Insights, including the focus score.

🆕 Things to settle: missing estimates, and contradictions inside a task.

🆕 Offline support through an IndexedDB copy and an outbox.

🆕 English and French.
