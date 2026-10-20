-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movie" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "releaseDate" TEXT,
    "overview" TEXT NOT NULL DEFAULT '',
    "posterPath" TEXT,
    "genreIds" INTEGER[],
    "popularity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voteAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "voteCount" INTEGER NOT NULL DEFAULT 0,
    "runtime" INTEGER,
    "imdbId" TEXT,
    "detailsAt" TIMESTAMP(3),
    "providers" JSONB,
    "providersAt" TIMESTAMP(3),
    "imdbRating" DOUBLE PRECISION,
    "rtScore" INTEGER,
    "metascore" INTEGER,
    "ratingsAt" TIMESTAMP(3),
    "recIds" INTEGER[],
    "recsAt" TIMESTAMP(3),
    "nlRelease" TEXT,
    "why" TEXT,
    "whyAt" TIMESTAMP(3),

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Swipe" (
    "userId" TEXT NOT NULL,
    "movieId" INTEGER NOT NULL,
    "verdict" TEXT NOT NULL,
    "elo" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "comparisons" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'swipe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Swipe_pkey" PRIMARY KEY ("userId","movieId")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "userId" TEXT NOT NULL,
    "movieId" INTEGER NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("userId","movieId")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Swipe_movieId_idx" ON "Swipe"("movieId");

-- AddForeignKey
ALTER TABLE "Swipe" ADD CONSTRAINT "Swipe_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swipe" ADD CONSTRAINT "Swipe_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
