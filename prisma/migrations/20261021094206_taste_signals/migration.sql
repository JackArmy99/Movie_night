-- AlterTable
ALTER TABLE "Movie" ADD COLUMN     "originalLanguage" TEXT,
ADD COLUMN     "people" JSONB,
ADD COLUMN     "peopleAt" TIMESTAMP(3),
ADD COLUMN     "vibes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vibesAt" TIMESTAMP(3);
