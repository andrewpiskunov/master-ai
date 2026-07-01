import { useMemo } from "react";
import { Link } from "react-router-dom";
import { getDocumentType, type Document } from "@master-ai/shared";
import { prepareMentions, matchMentions } from "../mentions.js";
import { pmText } from "../prosemirror-text.js";
import { TypeBadge } from "./campaign/shared.js";

// Обратные ссылки: документы кампании, в тексте которых упоминается текущий.
// Считаем на клиенте по названию — данные о связях в БД разрежены, а полный
// текст документов уже загружен в рабочее пространство.
export function MentionedInPanel({
  campaignId,
  documentId,
  title,
  documents,
}: {
  campaignId: string;
  documentId: string;
  title: string;
  documents: Document[];
}) {
  const refs = useMemo(() => {
    const prepared = prepareMentions([{ title, type: "" }]);
    if (!prepared.length) return []; // слишком короткое название — не ищем
    return documents.filter(
      (d) => d.id !== documentId && matchMentions(pmText(d.contentJson), prepared).length > 0,
    );
  }, [documents, documentId, title]);

  if (!refs.length) {
    return (
      <p className="muted mentioned-empty">
        Пока никто не ссылается на «{title}». Упомяните этот документ по названию в тексте других — и они появятся здесь.
      </p>
    );
  }
  return (
    <div className="mentioned-list">
      {refs.map((d) => (
        <Link key={d.id} to={`/campaigns/${campaignId}/documents/${d.id}`} className="mentioned-item">
          <TypeBadge type={d.type} size={24} />
          <span className="mentioned-item-title">{d.title}</span>
          <span className="mentioned-item-type">{getDocumentType(d.type)?.label ?? d.type}</span>
        </Link>
      ))}
    </div>
  );
}
