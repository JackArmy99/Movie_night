/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Letterboxd CSVs are sent in small batches, but leave headroom.
    serverActions: { bodySizeLimit: "4mb" },
  },
  images: { unoptimized: true },
};

export default nextConfig;
