import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Home, Lightbulb, BookOpen, Layers, Plus, PanelLeftClose, PanelLeftOpen, Trash2, Bookmark } from "lucide-react";
import { DOCUMENT_TYPES, getTemplate, type Campaign, type Document } from "@master-ai/shared";
import { api } from "../../api/client.js";
import { markdownToDoc } from "../../editor/DocumentEditor.js";
import { useToast } from "../../ui/toast.js";
import { Modal } from "../../ui/Modal.js";
import { Select } from "../../ui/Select.js";
import { SearchBox } from "../SearchBox.js";
import type { CampaignContext } from "./shared.js";
import { TypeBadge } from "./shared.js";
import { WorkshopChatProvider } from "./WorkshopChatContext.js";
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

  // Создание документа — через модалку, чтобы не плодить пустые документы.
  const [createType, setCreateType] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const reload = useCallback(() => {
    if (!campaignId) return;
    api.listCampaignDocuments(campaignId).then(setDocuments).catch(() => showToast("Не удалось загрузить документы"));
  }, [campaignId, showToast]);

  useEffect(() => {
    if (!campaignId) return;
    api.getCampaign(campaignId).then(setCampaign).catch(() => showToast("Не удалось загрузить кампанию"));
    reload();
  }, [campaignId, reload, showToast]);

  // Открывает окно создания (НЕ создаёт документ сразу).
  const createDocument = useCallback((type: string) => {
    setCreateType(type);
    setNewTitle("");
  }, []);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!campaignId || !createType || !newTitle.trim()) return;
    try {
      const template = getTemplate(createType);
      const doc = await api.createDocument({
        campaignId,
        type: createType,
        title: newTitle.trim(),
        contentJson: template ? markdownToDoc(template) : undefined,
      });
      setCreateType(null);
      setNewTitle("");
      navigate(`/campaigns/${campaignId}/documents/${doc.id}`);
    } catch {
      showToast("Не удалось создать документ");
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

  const ctx: CampaignContext = { campaignId: campaignId!, campaign, documents, reload, createDocument };

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
          <button type="button" className="ws-delete" onClick={() => { setDeleting(true); setDeleteConfirmed(false); }} title="Удалить кампанию">
            <Trash2 size={16} strokeWidth={1.8} /><span className="ws-label">Удалить кампанию</span>
          </button>
        </div>
      </aside>

      <WorkshopChatProvider campaignId={campaignId!} onApproved={reload}>
        <div className="workspace-main">
          <Outlet context={ctx} />
        </div>
      </WorkshopChatProvider>

      {createType && (
        <Modal title="Новый документ" onClose={() => setCreateType(null)}>
          <form onSubmit={submitCreate}>
            <label htmlFor="new-doc-title">Название</label>
            <input
              id="new-doc-title"
              placeholder="Например, Барон фон Кройц"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            <label htmlFor="new-doc-type">Тип</label>
            <Select
              id="new-doc-type"
              ariaLabel="Тип"
              value={createType ?? ""}
              onChange={setCreateType}
              options={DOCUMENT_TYPES.map((t) => ({ value: t.key, label: t.label }))}
            />
            <div className="modal-actions">
              <button type="submit" disabled={!newTitle.trim()}>Создать</button>
              <button type="button" className="btn-ghost" onClick={() => setCreateType(null)}>Отмена</button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Удалить кампанию" onClose={() => setDeleting(false)}>
          <p className="muted">
            Кампания «{campaign?.name ?? ""}» и весь её контент — документы, связи, беседа —
            будут удалены безвозвратно.
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={deleteConfirmed} onChange={(e) => setDeleteConfirmed(e.target.checked)} />
            Я понимаю, что это нельзя отменить
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-danger" disabled={!deleteConfirmed} onClick={confirmDelete}>
              Удалить навсегда
            </button>
            <button type="button" className="btn-ghost" onClick={() => setDeleting(false)}>Отмена</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
