ALTER TABLE users ADD COLUMN priority_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE platform_settings ADD COLUMN registration_closed_until INTEGER;
