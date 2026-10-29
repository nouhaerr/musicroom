BEGIN;
LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
-- Never silently merge accounts or discard their data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Email normalization blocked: resolve case-insensitive duplicate accounts before retrying migration';
  END IF;
END $$;
UPDATE "User" SET email = lower(btrim(email));
ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK (email = lower(btrim(email)));
COMMIT;
