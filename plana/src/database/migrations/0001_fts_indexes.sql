-- FTS indexes using pg_trgm and tsvector GIN
-- Applied after 0000_dark_paper_doll.sql creates the tables.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text search on messages content
CREATE INDEX idx_messages_content_fts
  ON messages
  USING gin (to_tsvector('english', content));

-- Full-text search on memories content
CREATE INDEX idx_memories_content_fts
  ON memories
  USING gin (to_tsvector('english', content));

-- Full-text search on pinned facts
CREATE INDEX idx_facts_fact_fts
  ON pinned_facts
  USING gin (to_tsvector('english', fact));

-- Full-text search on lore entries (title + content combined)
CREATE INDEX idx_lore_content_fts
  ON lore_entries
  USING gin (to_tsvector('english', content || ' ' || coalesce(title, '')));

-- Trigram indexes for fuzzy search on key columns
CREATE INDEX idx_messages_content_trgm
  ON messages
  USING gin (content gin_trgm_ops);

CREATE INDEX idx_memories_content_trgm
  ON memories
  USING gin (content gin_trgm_ops);

CREATE INDEX idx_facts_fact_trgm
  ON pinned_facts
  USING gin (fact gin_trgm_ops);

CREATE INDEX idx_lore_content_trgm
  ON lore_entries
  USING gin (content gin_trgm_ops);
