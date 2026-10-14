-- Deleting an account finds its syncs, and a sync finds the account's one in
-- flight, through this index. Alone in its file, like every concurrent build.
-- squawk-ignore require-lock-timeout, require-statement-timeout, prefer-robust-stmts
CREATE INDEX CONCURRENTLY imports_user_id_source_connection_id_idx
  ON public.imports (user_id, source_connection_id) WHERE source_connection_id IS NOT NULL;
