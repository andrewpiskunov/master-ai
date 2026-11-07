// Найденное ИИ противоречие между документами кампании.
export interface ConsistencyIssue {
  documents: string[]; // точные названия документов, между которыми расхождение
  contradiction: string;
  fix: string; // предложение, как устранить
}

export interface ConsistencyResult {
  issues: ConsistencyIssue[];
}
