import { CURRENT_USER_QUERY_KEY } from "@/features/auth/hooks/useCurrentUser";
import { AUTH_CHANGED_EVENT } from "@/lib/storage/clientCache";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

const NOTIFICATION_EVENTS_PATH = "/api/notifications/events";
const MAX_RECONNECT_DELAY_MS = 30_000;

interface NotificationChangeSession {
  login: string;
  queryKey: QueryKey;
  clients: Map<QueryClient, number>;
  source: EventSource | null;
  retryTimer: number | null;
  retryAttempt: number;
  authProbeIssued: boolean;
}

interface NotificationRefreshState {
  pending: boolean;
  running: boolean;
}

const notificationChangeSessions = new Map<string, NotificationChangeSession>();
const notificationRefreshStates = new WeakMap<
  QueryClient,
  Map<string, NotificationRefreshState>
>();
let lifecycleListenersInstalled = false;

export function refreshPersonalNotifications(
  queryClient: QueryClient,
  login: string,
  queryKey: QueryKey,
) {
  let loginStates = notificationRefreshStates.get(queryClient);
  if (!loginStates) {
    loginStates = new Map();
    notificationRefreshStates.set(queryClient, loginStates);
  }
  let state = loginStates.get(login);
  if (!state) {
    state = { pending: false, running: false };
    loginStates.set(login, state);
  }
  state.pending = true;
  if (state.running) return;

  state.running = true;
  void (async () => {
    try {
      while (state.pending) {
        state.pending = false;
        await queryClient.cancelQueries({ queryKey });
        await queryClient.invalidateQueries({
          queryKey,
          refetchType: "active",
        });
      }
    } finally {
      state.running = false;
      if (state.pending) {
        refreshPersonalNotifications(queryClient, login, queryKey);
      }
    }
  })();
}

function stopNotificationChangeTransport(session: NotificationChangeSession) {
  if (session.retryTimer !== null) {
    window.clearTimeout(session.retryTimer);
    session.retryTimer = null;
  }
  session.source?.close();
  session.source = null;
}

function canConnectToNotificationChanges(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    document.visibilityState !== "hidden" &&
    (typeof navigator === "undefined" || navigator.onLine)
  );
}

function connectNotificationChanges(session: NotificationChangeSession) {
  if (
    session.source ||
    session.clients.size === 0 ||
    session.retryTimer !== null ||
    !canConnectToNotificationChanges() ||
    typeof EventSource === "undefined"
  ) {
    return;
  }

  const source = new EventSource(NOTIFICATION_EVENTS_PATH);
  session.source = source;
  source.addEventListener("ready", () => {
    if (session.source !== source) return;
    session.retryAttempt = 0;
    session.authProbeIssued = false;
    for (const [queryClient] of session.clients) {
      refreshPersonalNotifications(
        queryClient,
        session.login,
        session.queryKey,
      );
    }
  });
  source.addEventListener("notifications_changed", () => {
    if (session.source !== source) return;
    for (const [queryClient] of session.clients) {
      refreshPersonalNotifications(
        queryClient,
        session.login,
        session.queryKey,
      );
    }
  });
  source.addEventListener("error", () => {
    if (session.source !== source) return;
    source.close();
    session.source = null;
    if (!session.authProbeIssued) {
      session.authProbeIssued = true;
      for (const [queryClient] of session.clients) {
        void queryClient.invalidateQueries({
          queryKey: CURRENT_USER_QUERY_KEY,
        });
      }
    }
    const delay = Math.min(
      1_000 * 2 ** session.retryAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    session.retryAttempt += 1;
    session.retryTimer = window.setTimeout(() => {
      session.retryTimer = null;
      connectNotificationChanges(session);
    }, delay);
  });
}

function handleNotificationLifecycleChange() {
  for (const session of notificationChangeSessions.values()) {
    if (canConnectToNotificationChanges()) {
      connectNotificationChanges(session);
    } else {
      stopNotificationChangeTransport(session);
      session.retryAttempt = 0;
    }
  }
}

function removeNotificationLifecycleListenersIfUnused() {
  if (!lifecycleListenersInstalled || notificationChangeSessions.size > 0)
    return;
  lifecycleListenersInstalled = false;
  document.removeEventListener(
    "visibilitychange",
    handleNotificationLifecycleChange,
  );
  window.removeEventListener("online", handleNotificationLifecycleChange);
  window.removeEventListener("offline", handleNotificationLifecycleChange);
  window.removeEventListener(AUTH_CHANGED_EVENT, handleNotificationAuthChange);
}

function handleNotificationAuthChange() {
  for (const session of notificationChangeSessions.values()) {
    stopNotificationChangeTransport(session);
    session.clients.clear();
  }
  notificationChangeSessions.clear();
  removeNotificationLifecycleListenersIfUnused();
}

function installNotificationLifecycleListeners() {
  if (lifecycleListenersInstalled) return;
  lifecycleListenersInstalled = true;
  document.addEventListener(
    "visibilitychange",
    handleNotificationLifecycleChange,
  );
  window.addEventListener("online", handleNotificationLifecycleChange);
  window.addEventListener("offline", handleNotificationLifecycleChange);
  window.addEventListener(AUTH_CHANGED_EVENT, handleNotificationAuthChange);
}

export function subscribeToNotificationChanges(
  login: string,
  queryClient: QueryClient,
  queryKey: QueryKey,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }
  let session = notificationChangeSessions.get(login);
  if (!session) {
    session = {
      login,
      queryKey,
      clients: new Map(),
      source: null,
      retryTimer: null,
      retryAttempt: 0,
      authProbeIssued: false,
    };
    notificationChangeSessions.set(login, session);
  }
  session.clients.set(queryClient, (session.clients.get(queryClient) ?? 0) + 1);
  installNotificationLifecycleListeners();
  connectNotificationChanges(session);

  return () => {
    const count = session.clients.get(queryClient) ?? 0;
    if (count > 1) session.clients.set(queryClient, count - 1);
    else session.clients.delete(queryClient);
    if (session.clients.size === 0) {
      stopNotificationChangeTransport(session);
      notificationChangeSessions.delete(login);
      removeNotificationLifecycleListenersIfUnused();
    }
  };
}
