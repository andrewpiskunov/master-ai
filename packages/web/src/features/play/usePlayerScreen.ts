import { useCallback, useEffect, useRef, useState } from "react";
import { ImageAttachmentSchema, type ImageAttachment } from "@master-ai/shared";
import { parsePlayerScreenMessage, playerChannelName, validPlayerChannelId, type PlayerImageState } from "./player-screen.js";

const blank = (): PlayerImageState => ({ image: null, captionVisible: false });
const unsupported = "Этот браузер не поддерживает связь с экраном игроков. Откройте игру в современном браузере.";
interface Controller {
  sessionId: string;
  channelId: string;
  channel: BroadcastChannel;
  popup: Window | null;
  active: boolean;
}

function sessionToken(sessionId: string): string {
  const key = `master-ai:player-screen:${sessionId}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored && validPlayerChannelId(stored)) return stored;
  } catch { /* Private browsing can disable storage; the live channel still works. */ }
  const token = crypto.randomUUID();
  try { sessionStorage.setItem(key, token); } catch { /* Keep an in-memory token. */ }
  return token;
}

export function usePlayerScreen(sessionId: string) {
  const controller = useRef<Controller | null>(null);
  const currentSession = useRef(sessionId);
  currentSession.current = sessionId;
  const latestState = useRef<PlayerImageState>(blank());
  const [view, setView] = useState({ sessionId, ...blank(), error: "" });

  useEffect(() => {
    latestState.current = blank();
    setView({ sessionId, ...blank(), error: "" });
    if (!sessionId) return;
    if (typeof BroadcastChannel === "undefined") { setView({ sessionId, ...blank(), error: unsupported }); return; }
    let connection: Controller;
    try {
      const channelId = sessionToken(sessionId);
      connection = { sessionId, channelId, channel: new BroadcastChannel(playerChannelName(channelId)), popup: null, active: true };
    } catch { setView({ sessionId, ...blank(), error: unsupported }); return; }
    controller.current = connection;
    connection.channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!connection.active || controller.current !== connection || currentSession.current !== sessionId) return;
      if (parsePlayerScreenMessage(event.data, connection.channelId)?.type === "ready") {
        try { connection.channel.postMessage({ type: "state", channelId: connection.channelId, ...latestState.current }); }
        catch { setView((state) => ({ ...state, error: "Связь с экраном игроков прервалась. Откройте его заново." })); }
      }
    };
    const resetPlayer = () => {
      latestState.current = blank();
      setView({ sessionId, ...blank(), error: "" });
      try { connection.channel.postMessage({ type: "state", channelId: connection.channelId, ...blank() }); }
      catch { setView((state) => ({ ...state, error: "Связь с экраном игроков прервалась. Откройте его заново." })); }
    };
    // Existing player windows do not repeat ready when the master reloads.
    resetPlayer();
    window.addEventListener("pagehide", resetPlayer);
    return () => {
      window.removeEventListener("pagehide", resetPlayer);
      connection.active = false;
      try { connection.channel.postMessage({ type: "state", channelId: connection.channelId, ...blank() }); } catch { /* Already disconnected. */ }
      connection.channel.onmessage = null;
      connection.channel.close();
      if (controller.current === connection) controller.current = null;
    };
  }, [sessionId]);

  const active = useCallback(() => {
    const value = controller.current;
    return value?.active && value.sessionId === sessionId && currentSession.current === sessionId ? value : null;
  }, [sessionId]);

  const openWindow = useCallback((connection: Controller, focus: boolean): boolean => {
    try {
      if (!connection.popup || connection.popup.closed) {
        connection.popup = window.open(`/player-screen/${connection.channelId}`, `master-ai-player-screen-${connection.channelId}`, "popup=yes,width=1280,height=800");
      }
      if (!connection.popup) {
        setView((state) => ({ ...state, error: "Браузер заблокировал всплывающее окно. Разрешите всплывающие окна для этого сайта." }));
        return false;
      }
      if (focus) connection.popup.focus();
      setView((state) => ({ ...state, error: "" }));
      return true;
    } catch {
      setView((state) => ({ ...state, error: "Не удалось открыть экран игроков. Разрешите всплывающие окна для этого сайта." }));
      return false;
    }
  }, []);

  const publish = useCallback((connection: Controller, state: PlayerImageState) => {
    latestState.current = state;
    setView({ sessionId: connection.sessionId, ...state, error: "" });
    try { connection.channel.postMessage({ type: "state", channelId: connection.channelId, ...state }); }
    catch { setView((value) => ({ ...value, error: "Связь с экраном игроков прервалась. Откройте его заново." })); }
  }, []);

  const open = useCallback(() => { const connection = active(); if (connection) openWindow(connection, true); }, [active, openWindow]);
  const show = useCallback((value: ImageAttachment, captionVisible = false) => {
    const connection = active();
    if (!connection) return;
    const image = ImageAttachmentSchema.safeParse(value);
    if (!image.success || typeof captionVisible !== "boolean") {
      setView((state) => ({ ...state, error: "Не удалось показать изображение: некорректные данные файла." }));
      return;
    }
    if (openWindow(connection, false)) publish(connection, { image: image.data, captionVisible });
  }, [active, openWindow, publish]);
  const clear = useCallback(() => { const connection = active(); if (connection) publish(connection, blank()); }, [active, publish]);

  const state = view.sessionId === sessionId ? view : { ...blank(), error: "" };
  return { image: state.image, captionVisible: state.captionVisible, error: state.error, open, show, clear };
}
