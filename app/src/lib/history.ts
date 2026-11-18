/**
 * Histórico de edições (desfazer / refazer).
 *
 * Edições rápidas e seguidas (arrastar um texto, mexer num slider, digitar)
 * entram como UM passo só: "desfazer" volta ao estado de antes do gesto inteiro,
 * não a um pixel antes.
 *
 * Módulo puro (sem DOM, sem React): dá pra testar sozinho.
 */

export interface History<T> {
  /** Estados anteriores (o último é o mais recente). */
  past: readonly T[];
  present: T;
  /** Estados desfeitos, prontos pra refazer (o último é o próximo). */
  future: readonly T[];
  /** Quando houve a última gravação (ms) — pra agrupar gestos rápidos. */
  lastPush: number;
}

/** Quantos passos guardamos (os mais antigos saem). */
export const HISTORY_LIMIT = 80;
/** Mudanças com menos que isso entre si contam como o mesmo gesto (ms). */
export const COALESCE_MS = 600;

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [], lastPush: 0 };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

/**
 * Registra um novo estado. Se vier logo depois do anterior (mesmo gesto), só
 * atualiza o estado atual — o passo de "antes do gesto" continua sendo o mesmo.
 * Qualquer edição nova descarta o "refazer".
 */
export function pushHistory<T>(
  h: History<T>,
  next: T,
  now: number,
  coalesceMs: number = COALESCE_MS,
  limit: number = HISTORY_LIMIT,
): History<T> {
  if (next === h.present) return h;
  const sameGesture = h.past.length > 0 && h.lastPush > 0 && now - h.lastPush <= coalesceMs;
  if (sameGesture) {
    return { past: h.past, present: next, future: [], lastPush: now };
  }
  const past = [...h.past, h.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
    lastPush: now,
  };
}

/** Desfaz um passo; `null` se não há o que desfazer. */
export function undoHistory<T>(h: History<T>): History<T> | null {
  if (h.past.length === 0) return null;
  const present = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present,
    future: [...h.future, h.present],
    // lastPush = 0: a próxima edição SEMPRE abre um passo novo (não gruda no gesto anterior)
    lastPush: 0,
  };
}

/** Refaz um passo; `null` se não há o que refazer. */
export function redoHistory<T>(h: History<T>): History<T> | null {
  if (h.future.length === 0) return null;
  const present = h.future[h.future.length - 1];
  return {
    past: [...h.past, h.present],
    present,
    future: h.future.slice(0, -1),
    lastPush: 0,
  };
}
