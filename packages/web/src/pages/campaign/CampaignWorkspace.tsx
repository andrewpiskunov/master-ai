import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Home, Lightbulb, BookOpen, Layers, Plus, PanelLeftClose, PanelLeftOpen, Bookmark, Settings, Wand2, Waypoints, Lightbulb as TipIcon } from "lucide-react";
import { DOCUMENT_TYPES, getDocumentType, getTemplate, getTips, type Campaign, type Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { markdownToDoc } from "../../editor/DocumentEditor.js";
import { streamComplete } from "../../api/stream.js";
import { useToast } from "../../ui/toast.js";
import { Modal } from "../../ui/Modal.js";
import { Select } from "../../ui/Select.js";
import { SearchBox } from "../SearchBox.js";
import type { CampaignContext } from "./shared.js";
import { TypeBadge } from "./shared.js";
import { WorkshopChatProvider } from "./WorkshopChatContext.js";
import { CommandPalette } from "./CommandPalette.js";
import { useBookmarks } from "../../bookmarks.js";

export function CampaignWorkspace() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const bookmarks = useBookmarks(campaignId);

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("ws-collapsed") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("ws-collapsed", collapsed ? "1" : "0"); } catch { /* ignore */ }
  }, [collapsed]);

  // Командная палитра по Cmd/Ctrl-K.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((v) => !v); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Создание документа — через модалку, чтобы не плодить пустые документы.
  const [createType, setCreateType] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(() => {
    if (!campaignId) return;
    api.listCampaignDocuments(campaignId).then(setDocuments).catch(() => showToast("Не удалось загрузить документы"));
  }, [campaignId, showToast]);

  const reloadCampaign = useCallback(() => {
    if (!campaignId) return;
    api.getCampaign(campaignId).then(setCampaign).catch(() => showToast("Не удалось загрузить кампанию"));
  }, [campaignId, showToast]);

  useEffect(() => {
    reloadCampaign();
    reload();
  }, [reloadCampaign, reload]);

  // Открывает окно создания (НЕ создаёт документ сразу).
  const createDocument = useCallback((type: string) => {
    setCreateType(type);
    setNewTitle("");
  }, []);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!campaignId || !createType || !newTitle.trim() || submitting) return;
    setSubmitting(true);
    try {
      const template = getTemplate(createType);
      // Сессиям присваиваем следующий порядковый номер — для сортировки и подписи.
      const fields = createType === "session"
        ? { sessionNumber: documents.reduce((max, d) => {
            const n = typeof d.fields?.sessionNumber === "number" ? d.fields.sessionNumber : 0;
            return n > max ? n : max;
          }, 0) + 1 }
        : undefined;
      const doc = await api.createDocument({
        campaignId,
        type: createType,
        title: newTitle.trim(),
        contentJson: template ? markdownToDoc(template) : undefined,
        fields,
      });
      setCreateType(null);
      setNewTitle("");
      reload();
      navigate(`/campaigns/${campaignId}/documents/${doc.id}`);
    } catch {
      showToast("Не удалось создать документ");
    } finally {
      setSubmitting(false);
    }
  }

  // Предложить название документа выбранного типа через ИИ.
  async function suggestTitle() {
    if (!createType || suggesting) return;
    setSuggesting(true);
    try {
      const label = getDocumentType(createType)?.label ?? createType;
      let out = "";
      await streamComplete(
        {
          system: `Ты помогаешь мастеру настольных ролевых игр. Предложи ОДНО короткое название (1–3 слова, без кавычек и пояснений) для нового документа типа «${label}»${campaign?.name ? ` в кампании «${campaign.name}»` : ""}. Верни только название.`,
          messages: [{ role: "user", content: `Предложи название для документа типа «${label}».` }],
        },
        (c) => { out += c; },
      );
      const name = out.trim().split("\n")[0].replace(/^["'«»\s]+|["'«»\s]+$/g, "");
      if (name) setNewTitle(name);
    } catch {
      showToast("Не удалось предложить название");
    } finally {
      setSuggesting(false);
    }
  }

  const ctx: CampaignContext = { campaignId: campaignId!, campaign, documents, reload, reloadCampaign, createDocument };

  return (
    <div className="workspace">
      <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
        <button
          type="button"
          className="ws-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>

        <Link to="/" className="ws-campaign" title={campaign?.name ?? ""}>
          <span className="ws-campaign-name">{campaign?.name ?? "…"}</span>
          <span className="ws-campaign-sub">Кампания</span>
        </Link>

        <nav className="ws-nav">
          <NavLink end to={`/campaigns/${campaignId}`} title="Обзор"><Home size={18} strokeWidth={1.8} /><span className="ws-label">Обзор</span></NavLink>
          <NavLink to={`/campaigns/${campaignId}/workshop`} title="Мастерская"><Lightbulb size={18} strokeWidth={1.8} /><span className="ws-label">Мастерская</span></NavLink>
          <NavLink to={`/campaigns/${campaignId}/knowledge`} title="База знаний"><BookOpen size={18} strokeWidth={1.8} /><span className="ws-label">База знаний</span></NavLink>
          <NavLink to={`/campaigns/${campaignId}/play`} title="Игровые материалы"><Layers size={18} strokeWidth={1.8} /><span className="ws-label">Игровые материалы</span></NavLink>
          <NavLink to={`/campaigns/${campaignId}/map`} title="Карта связей"><Waypoints size={18} strokeWidth={1.8} /><span className="ws-label">Карта связей</span></NavLink>
        </nav>

        {bookmarks.length > 0 && (
          <div className="ws-bookmarks">
            <div className="ws-bookmarks-head"><Bookmark size={14} strokeWidth={1.8} /><span className="ws-label">Закладки</span></div>
            <nav className="ws-bookmarks-list">
              {bookmarks.map((b) => (
                <NavLink key={b.id} to={`/campaigns/${campaignId}/documents/${b.id}`} className="ws-bookmark" title={b.title}>
                  <TypeBadge type={b.type} size={20} />
                  <span className="ws-label ws-bookmark-title">{b.title}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        )}

        <div className="ws-search">
          <SearchBox campaignId={campaignId!} />
        </div>

        <div className="ws-foot">
          <button type="button" className="ws-new" onClick={() => createDocument("note")} title="Новый документ">
            <Plus size={18} strokeWidth={2} /><span className="ws-label">Новый документ</span>
          </button>
          <NavLink to={`/campaigns/${campaignId}/manage`} className="ws-manage" title="Управление кампанией">
            <Settings size={16} strokeWidth={1.8} /><span className="ws-label">Управление кампанией</span>
          </NavLink>
        </div>
      </aside>

      <WorkshopChatProvider campaignId={campaignId!} onApproved={reload}>
        <div className="workspace-main">
          <Outlet context={ctx} />
        </div>
      </WorkshopChatProvider>

      {paletteOpen && (
        <CommandPalette campaignId={campaignId!} documents={documents} onCreate={createDocument} onClose={() => setPaletteOpen(false)} />
      )}

      {createType && (
        <Modal title="Новый документ" onClose={() => setCreateType(null)}>
          <form onSubmit={submitCreate}>
            <label htmlFor="new-doc-type">Тип документа</label>
            <Select
              id="new-doc-type"
              ariaLabel="Тип"
              value={createType ?? ""}
              onChange={setCreateType}
              options={DOCUMENT_TYPES.map((t) => ({ value: t.key, label: t.label }))}
            />
            <div className="field-head">
              <label htmlFor="new-doc-title">Название</label>
              <button type="button" className="suggest-btn" onClick={suggestTitle} disabled={suggesting}>
                <Wand2 size={14} strokeWidth={1.9} /> {suggesting ? "Подбираю…" : "Предложить"}
              </button>
            </div>
            <input
              id="new-doc-title"
              placeholder="Например, Барон фон Кройц"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            {getTips(createType).length > 0 && (
              <div className="tips-box">
                <div className="tips-head"><TipIcon size={15} strokeWidth={1.9} /> Совет: {getDocumentType(createType)?.label ?? createType}</div>
                <ul>{getTips(createType).map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            )}
            <div className="modal-actions">
              <button type="submit" disabled={!newTitle.trim() || submitting}>{submitting ? "Создаём…" : "Создать и открыть"}</button>
              <button type="button" className="btn-ghost" onClick={() => setCreateType(null)} disabled={submitting}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
