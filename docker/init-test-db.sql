-- Creates the dedicated Vitest test database alongside the dev database.
-- Postgres only runs files in /docker-entrypoint-initdb.d/ on a FRESH data volume
-- (first container init) — an already-initialized `postgres_data` volume needs the
-- database created manually, e.g.:
--   docker exec <container-name> psql -U postgres -c "CREATE DATABASE discord_clone_test;"
CREATE DATABASE discord_clone_test;
