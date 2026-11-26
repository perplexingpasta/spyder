-- P105 (2026-11-27): the Sleep tag. Like Gym and Food it's a break (kind 'break') named here, but it counts as
-- neither work nor break. SQLite can't change a CHECK in place, so the column is rebuilt (no rows are deleted, so
-- segments' ON DELETE CASCADE never fires).
ALTER TABLE sessions ADD COLUMN tag_new TEXT CHECK (tag_new IN ('gym', 'food', 'sleep'));
UPDATE sessions SET tag_new = tag;
ALTER TABLE sessions DROP COLUMN tag;
ALTER TABLE sessions RENAME COLUMN tag_new TO tag;
