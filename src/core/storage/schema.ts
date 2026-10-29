import type { DatabaseSync } from 'node:sqlite';

export function initStorageSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_objects (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      object_id           TEXT NOT NULL UNIQUE,
      storage_category    TEXT NOT NULL CHECK (storage_category IN ('gallery', 'asset')),
      entity_type         TEXT NOT NULL,
      entity_id           TEXT NOT NULL DEFAULT '',
      slot                TEXT NOT NULL DEFAULT 'primary',
      object_key          TEXT NOT NULL UNIQUE,
      public_url          TEXT NOT NULL,
      mime_type           TEXT NOT NULL,
      size_bytes          INTEGER NOT NULL,
      width               INTEGER,
      height              INTEGER,
      format              TEXT NOT NULL,
      original_filename   TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_replacement', 'pending_deletion', 'deleted')),
      deletion_attempts   INTEGER NOT NULL DEFAULT 0,
      last_deletion_error TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_storage_objects_cat_status ON storage_objects(storage_category, status);
    CREATE INDEX IF NOT EXISTS idx_storage_objects_entity ON storage_objects(entity_type, entity_id, slot);
    CREATE INDEX IF NOT EXISTS idx_storage_objects_key ON storage_objects(object_key);
    CREATE INDEX IF NOT EXISTS idx_storage_objects_status ON storage_objects(status);

    CREATE TABLE IF NOT EXISTS storage_reservations (
      id               TEXT PRIMARY KEY,
      storage_category TEXT NOT NULL CHECK (storage_category IN ('gallery', 'asset')),
      reserved_bytes   INTEGER NOT NULL,
      entity_type      TEXT NOT NULL,
      entity_id        TEXT NOT NULL DEFAULT '',
      expires_at       TEXT NOT NULL,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_storage_reservations_cat ON storage_reservations(storage_category, expires_at);
  `);
}
