-- P107 (2026-11-28): the "How I'll improve" gadget's rows. Copies of improvements, or written on the gadget.
CREATE TABLE gadget_rows (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,          -- the review's day, or the day it was written on the gadget ('YYYY-MM-DD' local)
  text TEXT NOT NULL,
  color TEXT,                  -- red | orange | yellow | green | blue | purple; NULL = none
  ticked_ms INTEGER,           -- NULL = fresh
  sort INTEGER NOT NULL DEFAULT 0,  -- the improvement's place in its review, so a batch keeps its order
  created_ms INTEGER NOT NULL,
  removed_ms INTEGER           -- kept, so auto-add doesn't bring a removed row back
);
CREATE INDEX gadget_rows_date ON gadget_rows(date);
-- First run: the last day that has improvements.
INSERT INTO gadget_rows (id, date, text, sort, created_ms)
  SELECT lower(hex(randomblob(16))), date, text, sort, 0 FROM review_items
  WHERE kind = 'improve' AND date = (SELECT MAX(date) FROM review_items WHERE kind = 'improve');
