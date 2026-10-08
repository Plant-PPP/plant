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
