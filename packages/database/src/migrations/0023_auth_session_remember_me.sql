-- Persist session intent; duration is not evidence of Remember Me consent.
-- NULL deliberately marks legacy/unknown sessions. Auth fails closed for these
-- rows until a fresh login issues an explicit true/false value. No guessed backfill.
ALTER TABLE auth_sessions ADD COLUMN remember_me boolean;
