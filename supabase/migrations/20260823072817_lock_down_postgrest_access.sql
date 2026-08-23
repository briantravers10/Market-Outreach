-- This application talks to Postgres directly with a server-side connection.
-- It does NOT use Supabase's client SDK, PostgREST, or Supabase Auth. So the
-- auto-generated REST surface should be closed completely rather than
-- selectively policed.
--
-- Enabling RLS with NO policies denies every PostgREST request (anon and
-- authenticated alike), because RLS defaults to deny when no policy grants
-- access. The server's own connection authenticates as a role that bypasses
-- RLS, so application queries are unaffected.
--
-- Without this, the anon key — which is designed to be published in client
-- code — could read and write every table here, including password hashes in
-- `users` and live reset tokens in `password_reset_tokens`.

ALTER TABLE public.campaigns             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mock_crm_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_activity        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.human_review_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.score_results         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- Belt and braces: revoke the REST roles' table privileges outright, so even a
-- future policy added by mistake cannot expose these tables.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
