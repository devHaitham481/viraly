import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // App Store artwork
    remotePatterns: [{ protocol: "https", hostname: "*.mzstatic.com" }],
  },
};

export default nextConfig;
