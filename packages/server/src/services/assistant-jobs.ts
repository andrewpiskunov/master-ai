// Фоновые генерации помощника документа. Задача живёт на сервере, поэтому
// навигация или закрытие вкладки клиента её не прерывают: ответ докапливается
// и сохраняется в беседу, а клиент опрашивает статус и дорисовывает partial.
export interface AssistantJobStatus {
  running: boolean;
  partial: string;
  error: string | null;
}

interface Job extends AssistantJobStatus {
  stopped: boolean;
}

const CLEANUP_MS = 60_000;

export class AssistantJobService {
  private jobs = new Map<string, Job>();

  status(docId: string): AssistantJobStatus {
    const j = this.jobs.get(docId);
    return j
      ? { running: j.running, partial: j.partial, error: j.error }
      : { running: false, partial: "", error: null };
  }

  // Останавливает генерацию; накопленный текст будет сохранён как ответ.
  stop(docId: string): boolean {
    const j = this.jobs.get(docId);
    if (!j?.running) return false;
    j.stopped = true;
    return true;
  }

  // Запускает генерацию в фоне; onFinish получает накопленный текст (в том числе
  // частичный при остановке). Одна задача на документ; повторный старт — false.
  start(docId: string, stream: AsyncIterable<string>, onFinish: (text: string) => void): boolean {
    if (this.jobs.get(docId)?.running) return false;
    const job: Job = { running: true, partial: "", error: null, stopped: false };
    this.jobs.set(docId, job);
    void (async () => {
      try {
        for await (const chunk of stream) {
          job.partial += chunk;
          if (job.stopped) break; // ранний return генератора корректно гасит CLI/поток
        }
      } catch (e) {
        job.error = e instanceof Error ? e.message : String(e);
      } finally {
        job.running = false;
        try {
          if (job.partial.trim()) onFinish(job.partial);
        } finally {
          // держим финальный статус ещё немного, чтобы клиент успел его забрать
          const t = setTimeout(() => { if (!this.jobs.get(docId)?.running) this.jobs.delete(docId); }, CLEANUP_MS);
          t.unref?.();
        }
      }
    })();
    return true;
  }
}
