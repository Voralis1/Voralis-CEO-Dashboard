import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Vercel's build container runs out of memory during the "Running
    // TypeScript" step on this project; type errors are still caught
    // locally and in the editor.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
