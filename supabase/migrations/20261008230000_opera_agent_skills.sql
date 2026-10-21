-- Skill memory v1 (2026-10-08): a shared table for task experience.
-- After a task, save what worked, what failed, and what recovered it; before a task, recall matching lessons into context.
-- Manual save/recall first; automatic extraction later, once there is data worth mining.
-- Seeds below are lessons already paid for in this repo's history, keyed by short stable markers the tests pin so they cannot silently vanish.

create table if not exists public.opera_skills (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  site text not null default '',
  lesson text not null,
  pitfalls text not null default '',
  created_at timestamptz not null default now()
);

revoke all on public.opera_skills from anon,authenticated;

insert into public.opera_skills (task, site, lesson, pitfalls) values
  ('open transcript panel', 'youtube',
   'stale-ref-after-scroll: re-query controls after any scroll; pre-scroll refs go stale and trusted clicks fail while synthetic ones silently no-op.',
   'Clicking a below-fold control without scrolling, then trusting a click that reports ok without semantic change.'),
  ('open transcript panel', 'youtube',
   'polymer-tap: custom-element buttons need trusted CDP input; synthetic DOM events never become Polymer tap gestures.',
   'Assuming ok:true on a synthetic click means the page reacted. Check postAction semantic change.'),
  ('summarize video', 'youtube',
   'caption-less-fallback: videos without captions have no transcript button at all; degrade to page-text chunks instead of dying in the open cascade.',
   'Hard waits and hard finds in the open cascade; every post-watch step must tolerate absence.'),
  ('find row in list', 'drive,docs',
   'fuzzy-count-zero: the fuzzy fallback returns count 0 with a nearby candidate; found must be decided by match count, never by item presence. Exact does not disable the fallback.',
   'Treating a returned item as a match without checking count.'),
  ('sense moving pixels', 'any-canvas',
   'throttle-reads-as-blindness: an occluded or backgrounded tab renders frozen frames; identical frames read as no motion. Keep the window foregrounded and distrust long all-zero streaks.',
   'Tuning thresholds for hours against data that was frozen, not blind.'),
  ('guard a real-time game', 'any-game',
   'guard-first: start the loop before any vision round trip; vision costs seconds and the game kills an unguarded player in four. Calibrate from human play, not theory.',
   'Verify-then-guard sequencing that hands the loop a corpse.')
on conflict do nothing;
