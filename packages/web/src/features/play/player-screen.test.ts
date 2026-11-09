import { describe, expect, it } from "vitest";
import { parsePlayerScreenMessage, playerChannelName } from "./player-screen.js";
import { picture, secondFixtureChannelId, fixtureChannelId } from "./player-screen.test-utils.js";

describe("player screen protocol", () => {
  it("accepts only matching-channel image state and strips all unrelated fields", () => {
    const raw = { type: "state", channelId: fixtureChannelId, image: { ...picture, notes: "Секрет", url: "https://foreign.test" }, captionVisible: false, campaign: "Скрытая кампания" };
    expect(parsePlayerScreenMessage(raw, fixtureChannelId)).toEqual({ type: "state", channelId: fixtureChannelId, image: picture, captionVisible: false });
    expect(playerChannelName(fixtureChannelId)).not.toBe(playerChannelName(secondFixtureChannelId));
  });

  it("validates ready and clear messages and rejects malformed or foreign payloads", () => {
    expect(parsePlayerScreenMessage({ type: "ready", channelId: fixtureChannelId }, fixtureChannelId)).toEqual({ type: "ready", channelId: fixtureChannelId });
    expect(parsePlayerScreenMessage({ type: "state", channelId: fixtureChannelId, image: null, captionVisible: false }, fixtureChannelId)).toEqual({ type: "state", channelId: fixtureChannelId, image: null, captionVisible: false });
    const state = { type: "state", channelId: fixtureChannelId, image: picture, captionVisible: false };
    for (const bad of [null, [], "ready", { ...state, channelId: secondFixtureChannelId }, { ...state, channelId: "bad" }, { ...state, captionVisible: "false" }, { ...state, captionVisible: NaN }, { ...state, image: { ...picture, id: "../../secret" } }, { ...state, image: { ...picture, mimeType: "image/svg+xml" } }]) {
      expect(parsePlayerScreenMessage(bad, fixtureChannelId)).toBeNull();
    }
  });
});
