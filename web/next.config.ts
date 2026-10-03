import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev -H 0.0.0.0` only trusts localhost; allow phones on the home LAN
  // to load dev resources (HMR websocket) so the page hydrates.
  allowedDevOrigins: ["192.168.*.*"],
};

export default nextConfig;
