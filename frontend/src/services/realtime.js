import { io } from "socket.io-client";

export const REALTIME_EVENTS = Object.freeze({
  MEASUREMENT_CREATED: "measurement-created",
  CONGESTION_DETECTED: "congestion-detected",
  CONGESTION_CLEARED: "congestion-cleared",
  ALERT_CREATED: "alert-created",
  ALERT_RESOLVED: "alert-resolved",
});

function getSocketEndpoint() {
  const apiUrl =
    import.meta.env?.VITE_API_BASE_URL || "http://localhost:5000/api";
  return new URL(apiUrl, globalThis.location?.origin || "http://localhost").origin;
}

export function createRealtimeClient(
  ioFactory = io,
  endpoint = getSocketEndpoint()
) {
  let socket = null;
  let activeToken = null;
  let status = "disconnected";
  const eventHandlers = new Map();
  const statusHandlers = new Map();

  function addHandler(handlers, handler) {
    handlers.set(handler, (handlers.get(handler) || 0) + 1);
  }

  function removeHandler(handlers, handler) {
    const count = handlers.get(handler);
    if (count === 1) handlers.delete(handler);
    else if (count > 1) handlers.set(handler, count - 1);
  }

  function setStatus(nextStatus) {
    if (status === nextStatus) return;
    status = nextStatus;
    for (const handler of statusHandlers.keys()) handler(status);
  }

  function removeSocket() {
    if (!socket) return;
    socket.removeAllListeners();
    socket.io.removeAllListeners();
    socket.disconnect();
    socket = null;
    activeToken = null;
    setStatus("disconnected");
  }

  function ensureEventDispatcher(eventName) {
    if (eventHandlers.has(eventName)) return;
    const handlers = new Map();
    const dispatcher = (payload) => {
      for (const handler of handlers.keys()) handler(payload, eventName);
    };
    eventHandlers.set(eventName, { handlers, dispatcher });
    socket.on(eventName, dispatcher);
  }

  function clearEventDispatcher(eventName) {
    const entry = eventHandlers.get(eventName);
    if (!entry || entry.handlers.size > 0) return;
    socket?.off(eventName, entry.dispatcher);
    eventHandlers.delete(eventName);
  }

  function subscribe(token, events, onEvent, onStatus) {
    if (!token) return () => {};

    if (socket && activeToken !== token) {
      removeSocket();
      eventHandlers.clear();
    }

    if (!socket) {
      activeToken = token;
      socket = ioFactory(endpoint, {
        autoConnect: false,
        auth: { token },
      });
      socket.on("connect", () => setStatus("connected"));
      socket.on("disconnect", () => setStatus("disconnected"));
      socket.on("connect_error", (error) => {
        if (error.data?.code === "UNAUTHORIZED") {
          setStatus("error");
          socket.disconnect();
          globalThis.window?.dispatchEvent(new Event("stm:unauthorized"));
          return;
        }
        setStatus("reconnecting");
      });
      socket.io.on("reconnect_attempt", () => setStatus("reconnecting"));
      socket.io.on("reconnect", () => setStatus("connected"));
      setStatus("connecting");
    }

    const subscribedEvents = [...new Set(events)];
    for (const eventName of subscribedEvents) {
      ensureEventDispatcher(eventName);
      addHandler(eventHandlers.get(eventName).handlers, onEvent);
    }
    if (onStatus) {
      addHandler(statusHandlers, onStatus);
      onStatus(status);
    }
    socket.connect();

    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      for (const eventName of subscribedEvents) {
        const entry = eventHandlers.get(eventName);
        if (entry) removeHandler(entry.handlers, onEvent);
        clearEventDispatcher(eventName);
      }
      if (onStatus) removeHandler(statusHandlers, onStatus);

      if (eventHandlers.size === 0 && statusHandlers.size === 0) {
        removeSocket();
      }
    };
  }

  return {
    subscribe,
    getStatus: () => status,
  };
}

const realtimeClient = createRealtimeClient();

export function subscribeToRealtimeEvents(token, events, onEvent, onStatus) {
  return realtimeClient.subscribe(token, events, onEvent, onStatus);
}
