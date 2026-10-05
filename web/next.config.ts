import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev -H 0.0.0.0` only trusts localhost; allow phones on the home LAN, and over
  // Tailscale (`tailscale serve` → https://<machine>.<tailnet>.ts.net), to load dev
  // resources (HMR websocket) so the page hydrates.
  allowedDevOrigins: ["192.168.*.*", "*.*.ts.net"],
  // The Agent SDK launches the native `claude` binary it resolves from node_modules; bundling breaks that lookup.
  serverExternalPackages: ["@anthropic-ai/claude-agent-sdk"],
};

export default nextConfig;
