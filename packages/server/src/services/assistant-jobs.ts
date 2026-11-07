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
  abort?: AbortController;
  done?: Promise<void>;
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

  // Останавливает генерацию НЕМЕДЛЕННО (сигнал обрывает CLI/HTTP у провайдера);
  // накопленный текст будет сохранён как ответ.
  stop(docId: string): boolean {
    const j = this.jobs.get(docId);
    if (!j?.running) return false;
    j.stopped = true;
    j.abort?.abort();
    return true;
  }

  // Остановка сервера ждёт выхода провайдеров и удаления временных изображений.
  async stopAll(): Promise<void> {
    const jobs = [...this.jobs.entries()];
    for (const [id, job] of jobs) if (job.running) this.stop(id);
    await Promise.all(jobs.map(([, job]) => job.done));
  }

  // Запускает генерацию в фоне; onFinish получает накопленный текст (в том числе
  // частичный при остановке). Одна задача на документ; повторный старт — false.
  // abort — контроллер, чей signal передан провайдеру: stop() обрывает генерацию через него.
  start(docId: string, stream: AsyncIterable<string>, onFinish: (text: string) => void, abort?: AbortController): boolean {
    if (this.jobs.get(docId)?.running) return false;
    const job: Job = { running: true, partial: "", error: null, stopped: false, abort };
    this.jobs.set(docId, job);
    job.done = (async () => {
      try {
        for await (const chunk of stream) {
          job.partial += chunk;
          if (job.stopped) break; // ранний return генератора корректно гасит CLI/поток
        }
      } catch (e) {
        // Обрыв потока после stop — штатная остановка, а не ошибка.
        if (!job.stopped) job.error = e instanceof Error ? e.message : String(e);
      } finally {
        try {
          // Сохранение может включать асинхронный импорт изображений. Пока оно
          // не завершено, клиент не должен считать ответ готовым или начать второй.
          if (job.partial.trim()) await onFinish(job.partial);
        } catch (error) {
          if (!job.stopped) job.error = error instanceof Error ? error.message : String(error);
        } finally {
          job.running = false;
          // держим финальный статус ещё немного, чтобы клиент успел его забрать
          const t = setTimeout(() => { if (!this.jobs.get(docId)?.running) this.jobs.delete(docId); }, CLEANUP_MS);
          t.unref?.();
        }
      }
    })();
    return true;
  }
}
