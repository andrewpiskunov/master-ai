import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Maximize, Minimize } from "lucide-react";
import { parsePlayerScreenMessage, playerChannelName, validPlayerChannelId, type PlayerImageState } from "./player-screen.js";
import "./PlayerScreen.css";

export function PlayerScreen() {
  const { channelId = "" } = useParams<{ channelId: string }>();
  return <PlayerScreenContent key={channelId} channelId={channelId} />;
}

function PlayerScreenContent({ channelId }: { channelId: string }) {
  const [state, setState] = useState<PlayerImageState>({ image: null, captionVisible: false });
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const stage = useRef<HTMLElement>(null);

  useEffect(() => {
    setState({ image: null, captionVisible: false }); setFailedImage(null); setError("");
    if (!validPlayerChannelId(channelId)) { setError("Ссылка на экран игроков недействительна. Откройте окно из режима игры."); return; }
    if (typeof BroadcastChannel === "undefined") { setError("Этот браузер не поддерживает экран игроков."); return; }
    let channel: BroadcastChannel | undefined;
    let active = true;
    const disconnect = () => { active = false; if (channel) { channel.onmessage = null; channel.close(); } };
    try {
      channel = new BroadcastChannel(playerChannelName(channelId));
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!active) return;
        const message = parsePlayerScreenMessage(event.data, channelId);
        if (message?.type !== "state") return;
        setState({ image: message.image, captionVisible: message.captionVisible }); setFailedImage(null); setError("");
      };
      channel.postMessage({ type: "ready", channelId });
    } catch { disconnect(); setError("Не удалось подключить экран игроков. Откройте окно заново."); return; }
    return disconnect;
  }, [channelId]);

  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.current?.requestFullscreen) await stage.current.requestFullscreen();
      else setError("Полный экран недоступен. Используйте полноэкранный режим браузера.");
    } catch { setError("Не удалось включить полный экран. Попробуйте ещё раз."); }
  }

  return <main ref={stage} className="player-screen" aria-label="Экран игроков">
    {state.image && failedImage !== state.image.id && <figure className="player-screen-figure">
      <img key={state.image.id} src={`/api/images/${state.image.id}`} alt={state.captionVisible ? state.image.name : "Изображение для игроков"} draggable={false} onError={() => setFailedImage(state.image!.id)} />
      {state.captionVisible && <figcaption>{state.image.name}</figcaption>}
    </figure>}
    {error ? <p className="player-screen-message" role="alert">{error}</p>
      : failedImage ? <p className="player-screen-message" role="status">Изображение недоступно. Ведущий может выбрать другое.</p>
        : !state.image && <p className="player-screen-message player-screen-waiting">Ожидание изображения</p>}
    <button className="player-screen-fullscreen" type="button" aria-label={fullscreen ? "Выйти из полного экрана" : "Полный экран"} title={fullscreen ? "Выйти из полного экрана" : "Полный экран"} onClick={() => { void toggleFullscreen(); }}>
      {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
    </button>
  </main>;
}
