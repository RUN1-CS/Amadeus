ALTER TABLE user_data_keys ADD COLUMN IF NOT EXISTS username_lookup TEXT;

UPDATE user_data_keys
SET username_lookup = users.username_lookup
FROM users
WHERE users.id = user_data_keys.user_id
  AND user_data_keys.username_lookup IS NULL
  AND users.username_lookup IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_data_keys_username_lookup_idx
    ON user_data_keys (username_lookup)
    WHERE username_lookup IS NOT NULL;

DROP INDEX IF EXISTS users_username_lookup_idx;
ALTER TABLE users DROP COLUMN IF EXISTS username_lookup;
