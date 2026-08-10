-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('emergency', 'standard');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('posted', 'bidding', 'quoted', 'dispatched', 'accepted', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('submitted', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('collecting', 'complete');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "homeowner_phone" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'collecting',
    "description" TEXT,
    "photo_urls" TEXT[],
    "address" TEXT,
    "transcript" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "homeowner_phone" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photo_urls" TEXT[],
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "urgency" "Urgency",
    "triage_confidence" DOUBLE PRECISION,
    "triage_reasoning" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'posted',
    "raw_transcript" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bidding_expires_at" TIMESTAMP(3),
    "dispatched_provider_ids" TEXT[],
    "assigned_provider_id" TEXT,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "specialties" TEXT[],
    "home_lat" DOUBLE PRECISION NOT NULL,
    "home_lng" DOUBLE PRECISION NOT NULL,
    "service_radius_miles" DOUBLE PRECISION NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "eta_minutes" INTEGER NOT NULL,
    "raw_text" TEXT NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'submitted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_homeowner_phone_status_idx" ON "conversations"("homeowner_phone", "status");

-- CreateIndex
CREATE INDEX "jobs_status_bidding_expires_at_idx" ON "jobs"("status", "bidding_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "providers_phone_key" ON "providers"("phone");

-- CreateIndex
CREATE INDEX "bids_job_id_status_idx" ON "bids"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bids_job_id_provider_id_key" ON "bids"("job_id", "provider_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_provider_id_fkey" FOREIGN KEY ("assigned_provider_id") REFERENCES "providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

