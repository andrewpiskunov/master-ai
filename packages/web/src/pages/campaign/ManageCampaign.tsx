import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2, Check, Loader, Download } from "lucide-react";
import type { Realism } from "@master-ai/shared";
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
  const [description, setDescription] = useState("");
  const [realism, setRealism] = useState<Realism>("balanced");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  // Инициализируем поля один раз на кампанию, чтобы reloadCampaign не затирал ввод.
  const initedRef = useRef<string | null>(null);
  const savedRef = useRef<{ name: string; description: string }>({ name: "", description: "" });

  useEffect(() => {
    if (!campaign || initedRef.current === campaign.id) return;
    initedRef.current = campaign.id;
    setName(campaign.name);
    setDescription(campaign.description ?? "");
    setRealism(campaign.realism);
    savedRef.current = { name: campaign.name, description: campaign.description ?? "" };
  }, [campaign]);

  // Автосохранение названия и брифа (как в документе) — без кнопки.
  useEffect(() => {
    if (!campaignId || initedRef.current !== campaignId) return;
    const trimmedName = name.trim();
    if (!trimmedName) return; // пустое название не сохраняем
    if (trimmedName === savedRef.current.name && description.trim() === savedRef.current.description) return;
    setSaveState("saving");
    const timer = setTimeout(() => {
      api.updateCampaign(campaignId, { name: trimmedName, description: description.trim() || null })
        .then(() => {
          savedRef.current = { name: trimmedName, description: description.trim() };
          setSaveState("saved");
          reloadCampaign();
        })
        .catch(() => { setSaveState("idle"); showToast("Не удалось сохранить"); });
    }, 700);
    return () => clearTimeout(timer);
  }, [name, description, campaignId, reloadCampaign, showToast]);

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
        <h2>Экспорт</h2>
        <p className="muted manage-hint">Собрать всю кампанию в один документ — для печати, сохранения в PDF или выгрузки в Markdown.</p>
        <Link to={`/campaigns/${campaignId}/export`} className="btn manage-export"><Download size={16} strokeWidth={1.8} /> Экспорт кампании</Link>
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
