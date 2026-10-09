-- Local data only: `supabase start` and `pnpm db:reset` load this file;
-- deploys never do. Sign in as test@plantia.io; the code arrives in Mailpit
-- (http://127.0.0.1:54324), which catches every local mail.

-- Auth reads these token columns as strings, so they are '' rather than NULL.
INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change,
                        email_change_token_new, email_change_token_current,
                        phone_change, phone_change_token, reauthentication_token)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'test@plantia.io', now(),
        '{"provider": "email", "providers": ["email"]}', '{}', now(), now(),
        '', '', '', '', '', '', '', '');

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider,
                             created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        '{"sub": "00000000-0000-4000-8000-000000000001", "email": "test@plantia.io", "email_verified": true}',
        'email', now(), now());

-- Signup already gave the user "Principal"; a second portfolio shows the list.
INSERT INTO public.portfolios (user_id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Largo plazo');

-- A holder and two accounts, one of them the holder's.
INSERT INTO public.holders (id, user_id, name)
VALUES ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Lucía');

INSERT INTO public.source_connections (user_id, institution, holder_id, default_portfolio_id)
SELECT p.user_id, c.institution, c.holder_id::uuid, p.id
FROM public.portfolios p
CROSS JOIN (VALUES ('IOL', NULL), ('Balanz', '00000000-0000-4000-8000-0000000000a1'))
  AS c (institution, holder_id)
WHERE p.user_id = '00000000-0000-4000-8000-000000000001' AND p.name = 'Principal';
