-- P106 (2026-11-28): the Sleep tag's colour is beige. An install still on the old indigo default moves to it; a
-- colour the user picked stays.
UPDATE settings SET value = '"#e8dcc4"' WHERE key = 'sleepColor' AND value = '"#6c71c4"';
