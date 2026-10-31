import type { Photon } from "@photon-ai/api";

export type Conversation = { spaceId: string; senderId: string };

// The client types these fields as unknown; this is their documented shape.
export type ReceivedMessage = {
  id: string;
  sentBy: { kind: string; handle?: string };
  receivedBy?: { kind: string; id: string };
  space: { kind: string; id: string };
  content?: { type: string; text?: string };
};

// A shared line cannot send the first message, so the conversation comes from
// the last text the configured person sent to it.
export async function findConversation(
  photon: Photon,
  project: string,
  handle: string,
): Promise<Conversation | undefined> {
  const page = await photon.projects.listMessages({
    path: { id: project },
    query: {
      direction: "received",
      order: "desc",
      pageSize: 100,
      platform: "imessage",
    },
  });
  const message = (page.items as unknown as ReceivedMessage[]).find(
    (m) =>
      m.sentBy.kind === "human" &&
      m.sentBy.handle === handle &&
      m.receivedBy?.kind === "agent" &&
      m.space.kind === "direct",
  );
  return (
    message?.receivedBy && {
      spaceId: message.space.id,
      senderId: message.receivedBy.id,
    }
  );
}
