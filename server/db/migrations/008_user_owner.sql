-- SPDX-License-Identifier: GPL-3.0-or-later
-- Copyright (C) 2026 RUN1-CS

-- The owner is an administrator with exclusive ownership-transfer privileges.
ALTER TABLE user_admins
    ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

WITH initial_owner AS (
    SELECT id
    FROM users
    ORDER BY (id = 1) DESC, id
    LIMIT 1
)
INSERT INTO user_admins (user_id, granted_at, granted_by, is_owner)
SELECT id, NOW(), NULL, TRUE FROM initial_owner
ON CONFLICT (user_id) DO UPDATE SET is_owner = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS user_admins_single_owner
    ON user_admins (is_owner) WHERE is_owner;

CREATE OR REPLACE FUNCTION enforce_existing_user_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM users)
       AND NOT EXISTS (SELECT 1 FROM user_admins WHERE is_owner) THEN
        RAISE EXCEPTION 'At least one owner must exist while user accounts exist';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_require_owner
    AFTER INSERT OR DELETE ON users
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enforce_existing_user_owner();

CREATE CONSTRAINT TRIGGER user_admins_require_owner
    AFTER INSERT OR UPDATE OR DELETE ON user_admins
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enforce_existing_user_owner();
