-- Likes and dislikes. Run once on a database made before them:
--   npx wrangler d1 execute wb2-gallery --remote --file migrations/0003_votes.sql
ALTER TABLE items ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN dislikes INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS item_votes (
  item_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  vote INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (item_id, ip_hash)
);
