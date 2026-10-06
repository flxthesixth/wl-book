CREATE TABLE "Guild" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eligibleRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "logChannelId" TEXT,
  "deadline" TIMESTAMP(3),
  "locked" BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE "Registration" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "discordId" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "wallet" TEXT NOT NULL,
  "eligibleRoleId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Registration_guildId_discordId_key" UNIQUE ("guildId", "discordId"),
  CONSTRAINT "Registration_guildId_wallet_key" UNIQUE ("guildId", "wallet")
);
CREATE TABLE "Snapshot" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "count" INTEGER NOT NULL,
  "csv" TEXT NOT NULL
);
CREATE INDEX "Snapshot_guildId_createdAt_idx" ON "Snapshot"("guildId", "createdAt");
CREATE FUNCTION reject_snapshot_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Snapshots are immutable';
END;
$$;
CREATE TRIGGER snapshot_immutable BEFORE UPDATE OR DELETE ON "Snapshot"
  FOR EACH ROW EXECUTE FUNCTION reject_snapshot_changes();
