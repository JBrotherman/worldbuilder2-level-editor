-- Reports get a reason (spam, inappropriate, impossible). Run once on a
-- database made with the first schema:
--   npx wrangler d1 execute wb2-gallery --remote --file migrations/0002_report_reasons.sql
ALTER TABLE items ADD COLUMN impossible INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS item_reports (
  item_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (item_id, ip_hash, reason)
);
INSERT OR IGNORE INTO item_reports (item_id, ip_hash, reason, created) SELECT item_id, ip_hash, 'spam', 0 FROM reports;
DROP TABLE reports;
