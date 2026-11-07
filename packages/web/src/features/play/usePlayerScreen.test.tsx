import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerScreen } from "./usePlayerScreen.js";
import { playerChannelName } from "./player-screen.js";
import { picture, secondPicture, secondFixtureChannelId, TestBroadcastChannel, fixtureChannelId } from "./player-screen.test-utils.js";

let popup: { closed: boolean; focus: ReturnType<typeof vi.fn> };
beforeEach(() => {
  TestBroadcastChannel.instances = [];
  sessionStorage.clear();
  popup = { closed: false, focus: vi.fn() };
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("usePlayerScreen", () => {
  it("opens blank, publishes only selected image metadata, and resends the latest image after ready", async () => {
    const { result } = renderHook(() => usePlayerScreen("session-one"));
    expect(result.current.image).toBeNull(); expect(result.current.captionVisible).toBe(false);
    act(() => result.current.open());
    const controller = TestBroadcastChannel.instances[0];
    const channelId = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0].split("/").at(-1);
    const player = new TestBroadcastChannel(playerChannelName(channelId));
    act(() => player.postMessage({ type: "ready", channelId }));
    await waitFor(() => expect(controller.sent.at(-1)).toEqual({ type: "state", channelId, image: null, captionVisible: false }));
    act(() => result.current.show({ ...picture, secret: "Заметки мастера" } as typeof picture));
    expect(result.current.image).toEqual(picture);
    expect(controller.sent.at(-1)).toEqual({ type: "state", channelId, image: picture, captionVisible: false });
    act(() => result.current.show(secondPicture, true));
    act(() => player.postMessage({ type: "ready", channelId }));
    await waitFor(() => expect(controller.sent.at(-1)).toEqual({ type: "state", channelId, image: secondPicture, captionVisible: true }));
    expect(window.open).toHaveBeenCalledTimes(1);
    act(() => result.current.clear());
    expect(result.current.image).toBeNull(); expect(result.current.captionVisible).toBe(false);
    expect(controller.sent.at(-1)).toEqual({ type: "state", channelId, image: null, captionVisible: false });
  });

  it("opens synchronously on show and does not focus the player for later images", () => {
    const { result } = renderHook(() => usePlayerScreen("session-one"));
    act(() => result.current.show(picture));
    expect(window.open).toHaveBeenCalledTimes(1);
    popup.focus.mockClear();
    act(() => result.current.show(secondPicture));
    expect(window.open).toHaveBeenCalledTimes(1); expect(popup.focus).not.toHaveBeenCalled();
    act(() => result.current.open());
    expect(popup.focus).toHaveBeenCalledTimes(1);
    popup.closed = true;
    act(() => result.current.show(picture));
    expect(window.open).toHaveBeenCalledTimes(2);
  });

  it("keeps session tokens isolated, reconnects after remount, and ignores stale handlers", async () => {
    const { result, rerender, unmount } = renderHook(({ id }) => usePlayerScreen(id), { initialProps: { id: "one" } });
    act(() => result.current.show(picture));
    const old = TestBroadcastChannel.instances[0]; const oldHandler = old.onmessage!;
    const oldShow = result.current.show;
    const oldCount = old.sent.length;
    rerender({ id: "two" });
    expect(old.closed).toBe(true);
    expect(old.sent.at(-1)).toMatchObject({ type: "state", image: null, captionVisible: false });
    expect(result.current.image).toBeNull();
    const active = TestBroadcastChannel.instances.at(-1)!;
    expect(active.name).not.toBe(old.name);
    act(() => { oldHandler({ data: { type: "ready", channelId: old.name.split(":").at(-1) } } as MessageEvent); oldShow(secondPicture); });
    expect(old.sent).toHaveLength(oldCount + 1); expect(active.sent).toHaveLength(1);
    act(() => result.current.show(secondPicture));
    const secondName = active.name;
    unmount();
    expect(active.closed).toBe(true); expect(active.sent.at(-1)).toMatchObject({ image: null });
    const remounted = renderHook(() => usePlayerScreen("two"));
    expect(TestBroadcastChannel.instances.at(-1)?.name).toBe(secondName);
    expect(Object.values(sessionStorage)).toHaveLength(2);
    expect(Object.values(sessionStorage).every((value) => /^[0-9a-f-]{36}$/i.test(value))).toBe(true);
    remounted.unmount();
  });

  it("ignores foreign ready messages and rejects invalid image IDs without opening", () => {
    sessionStorage.setItem("master-ai:player-screen:one", fixtureChannelId);
    const { result } = renderHook(() => usePlayerScreen("one"));
    const channel = TestBroadcastChannel.instances[0];
    act(() => channel.onmessage?.({ data: { type: "ready", channelId: secondFixtureChannelId } } as MessageEvent));
    expect(channel.sent).toHaveLength(1);
    act(() => result.current.show({ ...picture, id: "../private" }));
    expect(window.open).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/изображени/i);
  });

  it("reports blocked popups and unavailable channels without throwing", () => {
    vi.mocked(window.open).mockReturnValue(null);
    const { result } = renderHook(() => usePlayerScreen("blocked"));
    act(() => result.current.show(picture));
    expect(result.current.error).toMatch(/всплывающ/i);
    vi.stubGlobal("BroadcastChannel", undefined);
    const unsupported = renderHook(() => usePlayerScreen("unsupported"));
    act(() => unsupported.result.current.open());
    expect(unsupported.result.current.error).toMatch(/браузер/i);
  });

  it("works when session storage is unavailable and stays inactive without a session", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage blocked"); });
    const { result } = renderHook(() => usePlayerScreen("private-browser"));
    act(() => result.current.show(picture));
    expect(result.current.error).toBe("");
    expect(result.current.image).toEqual(picture);
    const inactive = renderHook(() => usePlayerScreen(""));
    act(() => inactive.result.current.show(picture));
    expect(inactive.result.current.image).toBeNull();
    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it("clears an existing player when a refreshed master connects without another ready message", async () => {
    sessionStorage.setItem("master-ai:player-screen:one", fixtureChannelId);
    const player = new TestBroadcastChannel(playerChannelName(fixtureChannelId));
    const receive = vi.fn();
    player.onmessage = receive;
    renderHook(() => usePlayerScreen("one"));
    await waitFor(() => expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      data: { type: "state", channelId: fixtureChannelId, image: null, captionVisible: false },
    })));
    expect(window.open).not.toHaveBeenCalled();
  });

  it("clears the player on page exit and cannot restore the old image after the page resumes", async () => {
    const { result, unmount } = renderHook(() => usePlayerScreen("one"));
    act(() => result.current.show(picture, true));
    const channel = TestBroadcastChannel.instances[0];
    const channelId = channel.name.split(":").at(-1);
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    expect(result.current.image).toBeNull();
    expect(result.current.captionVisible).toBe(false);
    expect(channel.sent.at(-1)).toEqual({ type: "state", channelId, image: null, captionVisible: false });
    const player = new TestBroadcastChannel(channel.name);
    act(() => player.postMessage({ type: "ready", channelId }));
    await waitFor(() => expect(channel.sent.at(-1)).toMatchObject({ image: null, captionVisible: false }));
    act(() => result.current.show(secondPicture));
    expect(result.current.image).toEqual(secondPicture);
    unmount();
    const count = channel.sent.length;
    act(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    expect(channel.sent).toHaveLength(count);
  });
});
