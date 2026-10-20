-- AlterTable
ALTER TABLE "Movie" ADD COLUMN     "trailerAt" TIMESTAMP(3),
ADD COLUMN     "trailerKey" TEXT;

-- AlterTable
ALTER TABLE "Swipe" ADD COLUMN     "stars" DOUBLE PRECISION;

-- Old swipes had no stars: give them the star value their verdict stood for.
-- (A Letterboxd re-import later restores exact half-star ratings.)
UPDATE "Swipe" SET "stars" = 5 WHERE "verdict" = 'superlike' AND "stars" IS NULL;
UPDATE "Swipe" SET "stars" = 4 WHERE "verdict" = 'like' AND "stars" IS NULL;
UPDATE "Swipe" SET "stars" = 2 WHERE "verdict" = 'dislike' AND "stars" IS NULL;
