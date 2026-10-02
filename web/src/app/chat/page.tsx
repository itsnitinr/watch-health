import type { Metadata } from "next";
import { Chat } from "./chat";

export const metadata: Metadata = { title: "Ask" };

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  const { q } = await searchParams;
  return <Chat initialQuestion={typeof q === "string" ? q.slice(0, 500) : undefined} />;
}
