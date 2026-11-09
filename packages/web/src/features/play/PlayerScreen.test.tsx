import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerScreen } from "./PlayerScreen.js";
import { playerChannelName } from "./player-screen.js";
import { picture, secondFixtureChannelId, TestBroadcastChannel, fixtureChannelId } from "./player-screen.test-utils.js";

beforeEach(() => { TestBroadcastChannel.instances = []; vi.stubGlobal("BroadcastChannel", TestBroadcastChannel); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const renderPlayer = (channelId = fixtureChannelId) => render(<MemoryRouter initialEntries={[`/player-screen/${channelId}`]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/player-screen/:channelId" element={<PlayerScreen />} /></Routes></MemoryRouter>);

describe("PlayerScreen", () => {
  it("announces ready, shows only a validated image, hides captions by default, and clears", async () => {
    const gm = new TestBroadcastChannel(playerChannelName(fixtureChannelId));
    renderPlayer();
    const player = TestBroadcastChannel.instances.at(-1)!;
    expect(player.sent).toEqual([{ type: "ready", channelId: fixtureChannelId }]);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    act(() => gm.postMessage({ type: "state", channelId: fixtureChannelId, image: { ...picture, secret: "Имя предателя" }, captionVisible: false }));
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("src", `/api/images/${picture.id}`);
    expect(img).toHaveAttribute("alt", "Изображение для игроков");
    expect(screen.queryByText(picture.name)).not.toBeInTheDocument();
    expect(screen.queryByText("Имя предателя")).not.toBeInTheDocument();
    act(() => gm.postMessage({ type: "state", channelId: fixtureChannelId, image: picture, captionVisible: true }));
    expect(await screen.findByText(picture.name)).toBeInTheDocument();
    act(() => gm.postMessage({ type: "state", channelId: fixtureChannelId, image: null, captionVisible: false }));
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
    expect(screen.queryByText(picture.name)).not.toBeInTheDocument();
  });

  it("rejects wrong channels, unsafe image IDs, URLs and nonboolean caption flags", async () => {
    renderPlayer();
    const channel = TestBroadcastChannel.instances[0];
    for (const payload of [
      { type: "state", channelId: secondFixtureChannelId, image: picture, captionVisible: false },
      { type: "state", channelId: fixtureChannelId, image: { ...picture, id: "https://evil.test/private" }, captionVisible: false },
      { type: "state", channelId: fixtureChannelId, image: picture, captionVisible: "true" },
    ]) act(() => channel.onmessage?.({ data: payload } as MessageEvent));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const invalid = renderPlayer("not-a-fixtureChannelId");
    expect(screen.getByRole("alert")).toHaveTextContent(/ссылка/i);
    invalid.unmount();
  });

  it("supports fullscreen and ignores late messages after closing its channel", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", { configurable: true, value: requestFullscreen });
    const { unmount } = renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "Полный экран" }));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    const channel = TestBroadcastChannel.instances[0];
    const stale = channel.onmessage!;
    unmount();
    expect(channel.closed).toBe(true);
    act(() => stale({ data: { type: "state", channelId: fixtureChannelId, image: picture, captionVisible: true } } as MessageEvent));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    delete (HTMLElement.prototype as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it("closes the channel when the ready handshake fails", () => {
    vi.spyOn(TestBroadcastChannel.prototype, "postMessage").mockImplementation(() => { throw new Error("blocked"); });
    renderPlayer();
    expect(screen.getByRole("alert")).toHaveTextContent(/подключить/i);
    expect(TestBroadcastChannel.instances[0].closed).toBe(true);
    expect(TestBroadcastChannel.instances[0].onmessage).toBeNull();
  });
});
