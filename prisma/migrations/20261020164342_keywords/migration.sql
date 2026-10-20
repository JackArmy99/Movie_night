-- AlterTable
ALTER TABLE "Movie" ADD COLUMN     "keywordIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "keywordsAt" TIMESTAMP(3);
