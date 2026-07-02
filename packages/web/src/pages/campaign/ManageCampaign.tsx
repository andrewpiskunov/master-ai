import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Check, Loader, Download } from "lucide-react";
import type { LlmProviderKind, Realism } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { useToast } from "../../ui/toast.js";
import { Modal } from "../../ui/Modal.js";
import { useGoBack } from "../../useGoBack.js";
import { useCampaign } from "./shared.js";

const REALISM: { key: Realism; label: string; hint: string }[] = [
  { key: "stylized", label: "Стилизованно", hint: "Героический, яркий тон — смелые образы, без приземлённости." },
  { key: "balanced", label: "Сбалансированно", hint: "Живо и образно, но с правдоподобной логикой и последствиями." },
  { key: "realistic", label: "Реалистично", hint: "Приземлённо и достоверно: логика, последствия, минимум пафоса." },
];

export function ManageCampaign() {
  const { campaignId, campaign, reloadCampaign } = useCampaign();
  const navigate = useNavigate();
  const goBack = useGoBack(`/campaigns/${campaignId}`);
  const { showToast } = useToast();

  const [name, setName] = useState("");
  const [system, setSystem] = useState("");
  const [description, setDescription] = useState("");
  const [realism, setRealism] = useState<Realism>("balanced");
  // Нейросеть кампании: Claude Code (cli) или OpenAI-совместимый API.
  const [llmProvider, setLlmProvider] = useState<LlmProviderKind>("cli");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  // Инициализируем поля один раз на кампанию, чтобы reloadCampaign не затирал ввод.
  const initedRef = useRef<string | null>(null);
  const savedRef = useRef<{ name: string; system: string; description: string }>({ name: "", system: "", description: "" });
  const savedLlmRef = useRef<string>("");

  useEffect(() => {
    if (!campaign || initedRef.current === campaign.id) return;
    initedRef.current = campaign.id;
    setName(campaign.name);
    setSystem(campaign.system ?? "");
    setDescription(campaign.description ?? "");
    setRealism(campaign.realism);
    setLlmProvider(campaign.llmProvider ?? "cli");
    setLlmKey(campaign.llmSettings?.apiKey ?? "");
    setLlmModel(campaign.llmSettings?.model ?? "");
    setLlmBaseUrl(campaign.llmSettings?.baseUrl ?? "");
    savedRef.current = { name: campaign.name, system: campaign.system ?? "", description: campaign.description ?? "" };
    savedLlmRef.current = JSON.stringify(campaign.llmSettings ?? {});
  }, [campaign]);

  // Автосохранение настроек OpenAI (ключ, модель, base URL) — с задержкой, как остальные поля.
  useEffect(() => {
    if (!campaignId || initedRef.current !== campaignId) return;
    const next = {
      ...(llmKey.trim() ? { apiKey: llmKey.trim() } : {}),
      ...(llmModel.trim() ? { model: llmModel.trim() } : {}),
      ...(llmBaseUrl.trim() ? { baseUrl: llmBaseUrl.trim() } : {}),
    };
    if (JSON.stringify(next) === savedLlmRef.current) return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      api.updateCampaign(campaignId, { llmSettings: next })
        .then(() => { savedLlmRef.current = JSON.stringify(next); setSaveState("saved"); reloadCampaign(); })
        .catch(() => { setSaveState("idle"); showToast("Не удалось сохранить"); });
    }, 700);
    return () => clearTimeout(timer);
  }, [llmKey, llmModel, llmBaseUrl, campaignId, reloadCampaign, showToast]);

  // Выбор нейросети применяем сразу (как тумблер).
  async function pickLlmProvider(p: LlmProviderKind) {
    setLlmProvider(p);
    if (!campaignId) return;
    try {
      await api.updateCampaign(campaignId, { llmProvider: p });
      reloadCampaign();
    } catch {
      showToast("Не удалось сохранить");
    }
  }

  // Автосохранение названия, системы и брифа (как в документе) — без кнопки.
  useEffect(() => {
    if (!campaignId || initedRef.current !== campaignId) return;
    const trimmedName = name.trim();
    if (!trimmedName) return; // пустое название не сохраняем
    if (trimmedName === savedRef.current.name && system.trim() === savedRef.current.system && description.trim() === savedRef.current.description) return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      api.updateCampaign(campaignId, { name: trimmedName, system: system.trim() || null, description: description.trim() || null })
        .then(() => {
          savedRef.current = { name: trimmedName, system: system.trim(), description: description.trim() };
          setSaveState("saved");
          reloadCampaign();
        })
        .catch(() => { setSaveState("idle"); showToast("Не удалось сохранить"); });
    }, 700);
    return () => clearTimeout(timer);
  }, [name, system, description, campaignId, reloadCampaign, showToast]);

  // Реализм применяем сразу (как тумблер настройки).
  async function pickRealism(r: Realism) {
    setRealism(r);
    if (!campaignId) return;
    try {
      await api.updateCampaign(campaignId, { realism: r });
      reloadCampaign();
    } catch {
      showToast("Не удалось сохранить");
    }
  }

  async function confirmDelete() {
    if (!campaignId || !deleteConfirmed) return;
    try {
      await api.deleteCampaign(campaignId);
      navigate("/");
    } catch {
      showToast("Не удалось удалить кампанию");
    }
  }

  return (
    <div className="view manage">
      <header className="view-head">
        <button type="button" className="doc-back" onClick={goBack} title="Назад"><ArrowLeft size={16} /></button>
        <div>
          <h1 className="page-title">Управление кампанией</h1>
          <p className="view-sub">Настройки кампании, тон и удаление.</p>
        </div>
      </header>

      <section className="panel manage-section">
        <div className="manage-section-head">
          <h2>Основное</h2>
          {saveState !== "idle" && (
            <span className={`save-status save-${saveState}`}>
              {saveState === "saving"
                ? <><Loader size={13} className="spin" /> Сохранение…</>
                : <><Check size={13} strokeWidth={2.4} /> Сохранено</>}
            </span>
          )}
        </div>
        <label htmlFor="mc-name">Название</label>
        <input id="mc-name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="mc-system">Система</label>
        <input
          id="mc-system"
          placeholder="Напр.: D&D 5e, Pathfinder 2e, Vampire: the Masquerade…"
          value={system}
          onChange={(e) => setSystem(e.target.value)}
        />
        <label htmlFor="mc-desc">Описание (бриф для ИИ)</label>
        <p className="muted manage-hint">
          Постоянный бриф, которому следуют ИИ-помощники во всей кампании — тон, жанр, темы, мир, домашние правила.
          Каждое предложение и правка пишутся под него, поэтому чем точнее, тем лучше результат.
        </p>
        <textarea
          id="mc-desc"
          className="manage-desc"
          rows={5}
          maxLength={5000}
          placeholder="Напр.: мрачный low-magic фронтир, игроки — наёмники в долгах. Тон жёсткий и морально-серый. Домашнее правило: смерть необратима."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </section>

      <section className="panel manage-section">
        <h2>Тон материалов</h2>
        <p className="muted manage-hint">Насколько «реалистичным» должен быть тон того, что предлагает и пишет ИИ.</p>
        <div className="realism-seg" role="group" aria-label="Реализм">
          {REALISM.map((r) => (
            <button key={r.key} type="button" className={`realism-opt${realism === r.key ? " active" : ""}`} onClick={() => pickRealism(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        <p className="muted manage-hint">{REALISM.find((r) => r.key === realism)?.hint}</p>
      </section>

      <section className="panel manage-section">
        <h2>Нейросеть</h2>
        <p className="muted manage-hint">Какая модель отвечает во всех ИИ-функциях кампании — мастерская, помощник документов, проверки, режим игры.</p>
        <div className="realism-seg" role="group" aria-label="Нейросеть">
          <button type="button" className={`realism-opt${llmProvider === "cli" ? " active" : ""}`} onClick={() => pickLlmProvider("cli")}>
            Claude Code (CLI)
          </button>
          <button type="button" className={`realism-opt${llmProvider === "openai" ? " active" : ""}`} onClick={() => pickLlmProvider("openai")}>
            OpenAI API
          </button>
        </div>
        {llmProvider === "cli" ? (
          <p className="muted manage-hint">Локальный Claude Code: запускается командой «claude» на этой машине, ключи не нужны.</p>
        ) : (
          <>
            <label htmlFor="mc-llm-key">API-ключ</label>
            <input
              id="mc-llm-key"
              type="password"
              placeholder="sk-…"
              autoComplete="off"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
            />
            <label htmlFor="mc-llm-model">Модель</label>
            <input
              id="mc-llm-model"
              placeholder="gpt-4o-mini (по умолчанию)"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
            />
            <label htmlFor="mc-llm-base">Base URL (необязательно)</label>
            <input
              id="mc-llm-base"
              placeholder="https://api.openai.com/v1 — или совместимый API (OpenRouter, локальная модель)"
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
            />
            <p className="muted manage-hint">
              Ключ хранится локально в базе этого приложения и никуда, кроме выбранного API, не отправляется.
              {llmProvider === "openai" && !llmKey.trim() && " Пока ключ не заполнен, используется Claude Code."}
            </p>
          </>
        )}
      </section>

      <section className="panel manage-section">
        <h2>Экспорт</h2>
        <p className="muted manage-hint">Собрать всю кампанию в один документ — для печати, сохранения в PDF или выгрузки в Markdown.</p>
        <div className="manage-export-row">
          <Link to={`/campaigns/${campaignId}/export`} className="btn manage-export"><Download size={16} strokeWidth={1.8} /> Экспорт кампании</Link>
          <a href="/api/backup" download className="btn-ghost manage-backup" title="Полная копия базы (все кампании) — для восстановления">
            <Download size={15} strokeWidth={1.8} /> Скачать резервную копию
          </a>
        </div>
        <p className="muted manage-hint">Сервер также сам делает дневную копию базы в data/backups (хранятся последние 7).</p>
      </section>

      <section className="panel manage-danger">
        <h2>Опасная зона</h2>
        <p className="muted">Удаление кампании уберёт её из списка вместе со всем контентом — документами, связями и беседой.</p>
        <button type="button" className="btn-danger manage-delete" onClick={() => { setDeleting(true); setDeleteConfirmed(false); }}>
          <Trash2 size={16} strokeWidth={1.8} /> Удалить кампанию
        </button>
      </section>

      {deleting && (
        <Modal title="Удалить кампанию" onClose={() => setDeleting(false)}>
          <p className="muted">
            Кампания «{campaign?.name ?? ""}» и весь её контент будут удалены безвозвратно.
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={deleteConfirmed} onChange={(e) => setDeleteConfirmed(e.target.checked)} />
            Я понимаю, что это нельзя отменить
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-danger" disabled={!deleteConfirmed} onClick={confirmDelete}>Удалить навсегда</button>
            <button type="button" className="btn-ghost" onClick={() => setDeleting(false)}>Отмена</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
