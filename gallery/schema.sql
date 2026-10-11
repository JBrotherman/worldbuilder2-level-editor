-- Gallery database (Cloudflare D1 / SQLite). For a database made before a
-- change, see migrations/.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,           -- short random id, used in links
  type TEXT NOT NULL,            -- 'level' or 'campaign'
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,            -- level text, or a .wb2campaign.json file
  info TEXT NOT NULL DEFAULT '{}', -- summary for the list (map size, missions)
  created INTEGER NOT NULL,      -- ms since 1970
  downloads INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,    -- spam/inappropriate reports (hidden at 5)
  impossible INTEGER NOT NULL DEFAULT 0, -- players who say it can't be finished
  likes INTEGER NOT NULL DEFAULT 0,
  dislikes INTEGER NOT NULL DEFAULT 0,
  delete_hash TEXT NOT NULL,     -- SHA-256 of the uploader's delete key
  ip_hash TEXT NOT NULL          -- for rate limiting (salted hash, not the IP)
);
CREATE INDEX IF NOT EXISTS items_created ON items (created);
CREATE INDEX IF NOT EXISTS items_ip ON items (ip_hash, created);

-- One row per person, item and reason ('spam', 'inappropriate', 'impossible').
CREATE TABLE IF NOT EXISTS item_reports (
  item_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (item_id, ip_hash, reason)
);

-- One like (1) or dislike (-1) per person and item.
CREATE TABLE IF NOT EXISTS item_votes (
  item_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  vote INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (item_id, ip_hash)
);
