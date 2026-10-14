-- An account's institution site and its icon (PLA-102): for an institution
-- the app ships no icon of, the user may give its site, and Plant's server
-- reads its icon once and stores it with the account, as a data URL of an
-- image of at most 64 KiB. The checks hold the shape; the server checks the
-- bytes are the image they say.
SET lock_timeout = '5s';
SET statement_timeout = '5min';

ALTER TABLE public.source_connections
  ADD COLUMN website text
    CONSTRAINT source_connections_website
    CHECK (char_length(website) BETWEEN 9 AND 200 AND website ~ '^https://[^\s]+$'),
  ADD COLUMN icon text
    CONSTRAINT source_connections_icon
    CHECK (char_length(icon) <= 87500
           AND icon ~ '^data:image/(png|x-icon|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$');

COMMENT ON COLUMN public.source_connections.website IS
  'The institution''s site as the user gave it, https only.';
COMMENT ON COLUMN public.source_connections.icon IS
  'The site''s icon as a data URL, read by Plant''s server from website.';

GRANT INSERT (website, icon), UPDATE (website, icon)
  ON TABLE public.source_connections TO authenticated;
