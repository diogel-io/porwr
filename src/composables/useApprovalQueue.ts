import { computed, onMounted, onUnmounted, ref, type Ref } from 'vue';

import { connectPanelPort, type PanelPortHandle } from '@/services/panel-port';
import { sendBexMessage } from '@/services/bridge-client';
import { LogLevel, logService } from '@/services/log-service';
import type {
  ApprovalDuration,
  ApprovalRequestContent,
  ApprovalRequestRecord,
  DecisionResult,
} from '@/../src-bex/types/background';

/**
 * Panel-side view of the background request queue.
 *
 * The panel observes and submits decisions; the background owns lifecycle (ADR D1). Nothing here
 * caches authoritative state: every decision is followed by a refresh from the background, so a
 * request that expired or was interrupted meanwhile cannot linger on screen as actionable.
 *
 * State is module-scoped so every consumer in the panel observes one queue. The header shows the
 * pending count while the page shows the request itself; per-caller state would mean two readers
 * racing each other and a count that could disagree with what is on screen.
 *
 * Nothing polls. The background pushes a bare "the queue moved" notification over the panel port
 * and this re-reads (#140). A push carries no state, so it cannot be stale or arrive behind a
 * decision the background has already applied; the answer always comes from a fresh read.
 */

export interface UseApprovalQueueResult {
  pending: Ref<ApprovalRequestRecord[]>;
  current: Ref<ApprovalRequestRecord | null>;
  content: Ref<ApprovalRequestContent | null>;
  pendingCount: Ref<number>;
  loading: Ref<boolean>;
  refresh: () => Promise<void>;
  decide: (id: string, approved: boolean, duration: ApprovalDuration) => Promise<DecisionResult>;
}

const pending = ref<ApprovalRequestRecord[]>([]);
const current = ref<ApprovalRequestRecord | null>(null);
const content = ref<ApprovalRequestContent | null>(null);
const loading = ref(true);
const pendingCount = computed(() => pending.value.length);

let consumers = 0;
let panelPort: PanelPortHandle | undefined;

const loadContent = async (id: string | undefined): Promise<void> => {
  if (!id) {
    content.value = null;
    return;
  }
  content.value = (await sendBexMessage('nostr.requests.content', { requestId: id })) ?? null;
};

const refresh = async (): Promise<void> => {
  try {
    const records = (await sendBexMessage('nostr.requests.list')) ?? [];
    pending.value = records;

    const next = (await sendBexMessage('nostr.requests.current')) ?? null;
    const changed = next?.id !== current.value?.id;
    current.value = next;

    if (next && next.state !== 'presented') {
      await sendBexMessage('nostr.requests.present', { requestId: next.id });
    }
    if (changed) {
      await loadContent(next?.id);
    }
  } catch (error: unknown) {
    logService.log(LogLevel.DEBUG, '[Panel] Failed to refresh request queue', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    loading.value = false;
  }
};

const decide = async (
  id: string,
  approved: boolean,
  duration: ApprovalDuration,
): Promise<DecisionResult> => {
  const result = (await sendBexMessage('nostr.requests.respond', {
    requestId: id,
    approved,
    duration,
  })) ?? { applied: false as const, reason: 'unknown-request' as const };

  // Always re-read: the background is the authority on what happened, including refusals.
  await refresh();
  return result;
};

/**
 * Discards the shared queue state and stops the poller.
 *
 * Module-scoped state outlives a component, which is the point in the panel and a hazard in tests.
 * Exported so a suite can start from a known queue rather than inheriting the previous test's.
 */
export function resetApprovalQueue(): void {
  panelPort?.disconnect();
  panelPort = undefined;
  consumers = 0;
  pending.value = [];
  current.value = null;
  content.value = null;
  loading.value = true;
}

export function useApprovalQueue(): UseApprovalQueueResult {
  onMounted(() => {
    consumers += 1;

    // One presence port per panel, not per consumer: the background counts connections, so a
    // second port would make a single panel look like two.
    panelPort ??= connectPanelPort({
      // A reconnect means the worker restarted and may have reconciled the queue while it was
      // gone, so nothing on screen can be trusted until it has been re-read.
      onReconnect: () => {
        void refresh();
      },
      onQueueChanged: () => {
        void refresh();
      },
    });

    // The one read that is not driven by a notification: what is already waiting when the panel
    // opens. Everything after this arrives as a push.
    void refresh();
  });

  onUnmounted(() => {
    consumers -= 1;
    if (consumers > 0) return;

    panelPort?.disconnect();
    panelPort = undefined;

    // Closing the panel is never a decision: hand the request back to the queue (FR-6). This runs
    // only once the last consumer has gone, so navigating within the panel does not requeue. The
    // presence port covers the cases this cannot reach, such as the window being closed outright.
    void sendBexMessage('nostr.requests.requeuePresented').catch(() => {
      /* the background reconciles on its own if this never lands */
    });
  });

  return { pending, current, content, pendingCount, loading, refresh, decide };
}
