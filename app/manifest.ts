import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AGENTME",
    short_name: "AGENTME",
    description: "Your AI agent handles the conversation. You make the decisions.",
    start_url: "/chats",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#2f6b4f",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
