-- Gallery database (Cloudflare D1 / SQLite).
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
  reports INTEGER NOT NULL DEFAULT 0,
  delete_hash TEXT NOT NULL,     -- SHA-256 of the uploader's delete key
  ip_hash TEXT NOT NULL          -- for rate limiting (salted hash, not the IP)
);
CREATE INDEX IF NOT EXISTS items_created ON items (created);
CREATE INDEX IF NOT EXISTS items_ip ON items (ip_hash, created);

CREATE TABLE IF NOT EXISTS reports (
  item_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (item_id, ip_hash)
);
