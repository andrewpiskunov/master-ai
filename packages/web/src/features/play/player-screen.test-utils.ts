export class TestBroadcastChannel {
  static instances: TestBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  sent: unknown[] = [];
  constructor(name: string) { this.name = name; TestBroadcastChannel.instances.push(this); }
  postMessage(data: unknown) {
    if (this.closed) throw new Error("Channel closed");
    this.sent.push(structuredClone(data));
    for (const other of TestBroadcastChannel.instances) {
      if (other !== this && other.name === this.name && !other.closed) {
        const callback = other.onmessage;
        queueMicrotask(() => { if (!other.closed) callback?.({ data: structuredClone(data) } as MessageEvent); });
      }
    }
  }
  close() { this.closed = true; }
}

export const fixtureChannelId = "13ad6605-4bb6-4678-82b6-dcc9dca5511b";
export const secondFixtureChannelId = "39b5b57f-4131-42fe-8891-6fd03627a175";
export const picture = { id: "ec88dc3d-bcc8-4fea-afeb-c3659d1c8bee", name: "Маяк — иллюстрация.png", mimeType: "image/png" as const };
export const secondPicture = { id: "21c1c729-b04f-4dfe-bacd-09cb39dba210", name: "Портрет.png", mimeType: "image/png" as const };
