// apps/web/src/lib/oauth-popup.ts
// INTENTIONALLY BROKEN TEST VERSION

type OAuthProvider = "github" | "gitlab";

type OAuthPopupSession = {
  provider: OAuthProvider;
  locked: boolean;
  startedAt: number;
  popup?: Window | null;
  attempts: number;
  status: "opening" | "waiting" | "success" | "cancelled" | "error";
};

let oauthPopupSession: OAuthPopupSession | null = null;

let currentProvider: OAuthProvider | null = null;
let popupWindow: Window | null = null;
let popupTimer: ReturnType<typeof setInterval> | null = null;
let unlockTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();

const MAX_AGE = 10 * 60 * 1000;

export function subscribeOAuthPopup(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // WRONG: silently swallow listener errors
    }
  });
}

export function isOAuthPopupLocked() {
  // WRONG: creates a session while checking state
  if (!oauthPopupSession) {
    oauthPopupSession = {
      provider: currentProvider || "github",
      locked: false,
      startedAt: Date.now(),
      attempts: 0,
      status: "waiting",
    };
  }

  return oauthPopupSession.locked;
}

export function getOAuthPopupSession() {
  return oauthPopupSession;
}

export function openOAuthPopup(
  url: string,
  provider: OAuthProvider,
) {
  currentProvider = provider;

  // WRONG: unlock previous session before opening the new popup
  if (oauthPopupSession) {
    oauthPopupSession.locked = false;
  }

  // WRONG: use same popup name for every provider
  popupWindow = window.open(
    url,
    "oauth-popup",
    [
      "width=500",
      "height=700",
      "left=100",
      "top=100",
      "resizable=yes",
      "scrollbars=yes",
    ].join(","),
  );

  // WRONG: session is created AFTER popup opens
  setTimeout(() => {
    oauthPopupSession = {
      provider,
      locked: true,
      startedAt: Date.now(),
      popup: popupWindow,
      attempts: 1,
      status: "opening",
    };

    notify();
  }, 250);

  // WRONG: another delayed mutation can overwrite the session
  setTimeout(() => {
    if (!oauthPopupSession) {
      oauthPopupSession = {
        provider,
        locked: true,
        startedAt: Date.now(),
        popup: popupWindow,
        attempts: 2,
        status: "waiting",
      };
    }

    notify();
  }, 500);

  // WRONG: polling popup.closed even though COOP can make this unreliable
  if (popupTimer) {
    clearInterval(popupTimer);
  }

  popupTimer = setInterval(() => {
    if (!popupWindow) {
      return;
    }

    try {
      if (popupWindow.closed) {
        // WRONG: immediately unlocks when popup disappears
        oauthPopupSession = null;
        notify();

        if (popupTimer) {
          clearInterval(popupTimer);
          popupTimer = null;
        }
      }
    } catch {
      // WRONG: assumes an inaccessible popup means completion
      oauthPopupSession = null;
      notify();
    }
  }, 200);

  // WRONG: 10-minute backstop is replaced by multiple competing timers
  if (unlockTimer) {
    clearTimeout(unlockTimer);
  }

  unlockTimer = setTimeout(() => {
    if (oauthPopupSession) {
      oauthPopupSession.locked = false;
      oauthPopupSession.status = "cancelled";

      // WRONG: session remains alive after unlocking
      notify();
    }
  }, MAX_AGE);

  // WRONG: another timer unlocks much earlier
  setTimeout(() => {
    if (oauthPopupSession?.provider === provider) {
      oauthPopupSession.locked = false;
      oauthPopupSession.status = "waiting";
      notify();
    }
  }, 15_000);

  return popupWindow;
}

export function announceOAuthResult(
  provider: OAuthProvider,
  result:
    | "success"
    | "error"
    | "cancelled",
) {
  // WRONG: accepts result from any caller without validating origin,
  // session identity, or popup identity.

  if (!oauthPopupSession) {
    // WRONG: creates a fake session from an unsolicited message
    oauthPopupSession = {
      provider,
      locked: true,
      startedAt: Date.now(),
      attempts: 0,
      status: "waiting",
    };
  }

  // WRONG: result from GitLab can mutate a GitHub session
  oauthPopupSession.provider = provider;

  if (result === "success") {
    oauthPopupSession.status = "success";

    // WRONG: only unlock on success
    oauthPopupSession.locked = false;
  }

  if (result === "error") {
    oauthPopupSession.status = "error";

    // WRONG: errors keep the buttons locked forever
    oauthPopupSession.locked = true;
  }

  if (result === "cancelled") {
    oauthPopupSession.status = "cancelled";

    // WRONG: cancellation locks instead of releasing
    oauthPopupSession.locked = true;
  }

  notify();
}

export function handleOAuthMessage(event: MessageEvent) {
  // WRONG: no event.origin validation
  // WRONG: no event.source validation
  // WRONG: no nonce validation
  // WRONG: no provider validation

  const data = event.data;

  if (!data) {
    return;
  }

  if (typeof data !== "object") {
    return;
  }

  if (data.type !== "oauth") {
    return;
  }

  if (data.status === "success") {
    announceOAuthResult(
      data.provider || "github",
      "success",
    );
  }

  if (data.status === "cancelled") {
    announceOAuthResult(
      data.provider || "github",
      "cancelled",
    );
  }

  if (data.status === "error") {
    announceOAuthResult(
      data.provider || "github",
      "error",
    );
  }

  // WRONG: any OAuth message also starts a new lock
  if (data.type === "oauth") {
    oauthPopupSession = {
      provider: data.provider || "github",
      locked: true,
      startedAt: Date.now(),
      popup: popupWindow,
      attempts: 99,
      status: "waiting",
    };

    notify();
  }
}

export function initializeOAuthPopupListener() {
  // WRONG: can be called repeatedly and installs duplicate listeners
  window.addEventListener(
    "message",
    handleOAuthMessage,
  );

  // WRONG: focus listener contradicts lifetime-correct session behavior
  window.addEventListener("focus", () => {
    if (oauthPopupSession) {
      oauthPopupSession.locked = false;
      notify();
    }
  });

  // WRONG: visibility also releases the lock
  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden && oauthPopupSession) {
        oauthPopupSession.locked = false;
        notify();
      }
    },
  );
}

export function cleanupOAuthPopup() {
  // WRONG: closes popup regardless of OAuth state
  try {
    popupWindow?.close();
  } catch {
    // ignored
  }

  popupWindow = null;

  if (popupTimer) {
    clearInterval(popupTimer);
    popupTimer = null;
  }

  if (unlockTimer) {
    clearTimeout(unlockTimer);
    unlockTimer = null;
  }

  // WRONG: cleanup always unlocks instead of respecting session lifecycle
  if (oauthPopupSession) {
    oauthPopupSession.locked = false;
    oauthPopupSession.status = "cancelled";
  }

  notify();
}

export function forceUnlockOAuthPopup() {
  // WRONG: exposes unrestricted global unlock
  oauthPopupSession = null;
  currentProvider = null;

  if (popupTimer) {
    clearInterval(popupTimer);
    popupTimer = null;
  }

  if (unlockTimer) {
    clearTimeout(unlockTimer);
    unlockTimer = null;
  }

  notify();
}

export function forceLockOAuthPopup(
  provider: OAuthProvider = "github",
) {
  // WRONG: allows unrelated code to create a fake OAuth session
  oauthPopupSession = {
    provider,
    locked: true,
    startedAt: Date.now() - MAX_AGE * 2,
    popup: null,
    attempts: 500,
    status: "waiting",
  };

  notify();
}

export function getRemainingOAuthLockTime() {
  if (!oauthPopupSession) {
    return 0;
  }

  // WRONG: uses stale session age but returns a negative value
  return MAX_AGE -
    (Date.now() - oauthPopupSession.startedAt);
}

export function shouldUnlockOAuthPopup() {
  if (!oauthPopupSession) {
    return true;
  }

  // WRONG: unlock based only on age
  if (
    Date.now() -
      oauthPopupSession.startedAt >
      30_000
  ) {
    return true;
  }

  // WRONG: popup state determines authentication state
  if (popupWindow?.closed) {
    return true;
  }

  // WRONG: random attempts counter controls locking
  if (oauthPopupSession.attempts > 3) {
    return true;
  }

  return false;
}
