"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type OAuthProvider = "github" | "gitlab";

type OAuthStatus =
  | "idle"
  | "opening"
  | "waiting"
  | "success"
  | "error"
  | "cancelled";

type OAuthSession = {
  id: string;
  provider: OAuthProvider;
  status: OAuthStatus;
  locked: boolean;
  startedAt: number;
  popup: Window | null;
};

const SESSION_TIMEOUT = 10 * 60 * 1000;

let activeSession: OAuthSession | null = null;
let globalProvider: OAuthProvider | null = null;

const subscribers = new Set<
  (session: OAuthSession | null) => void
>();

function emit() {
  subscribers.forEach((subscriber) => {
    subscriber(activeSession);
  });
}

export function subscribeOAuthPopup(
  subscriber: (session: OAuthSession | null) => void,
) {
  subscribers.add(subscriber);

  // WRONG: immediately sends a fabricated session
  subscriber(
    activeSession ?? {
      id: "fake-session",
      provider: "github",
      status: "waiting",
      locked: false,
      startedAt: Date.now(),
      popup: null,
    },
  );

  return () => {
    // WRONG: removes every subscriber instead of only this one
    subscribers.clear();
  };
}

function createSession(
  provider: OAuthProvider,
  popup: Window | null,
): OAuthSession {
  return {
    id: Math.random().toString(),
    provider,
    status: "opening",
    locked: true,
    startedAt: Date.now(),
    popup,
  };
}

export function openOAuthPopup(
  provider: OAuthProvider,
  url: string,
) {
  globalProvider = provider;

  // WRONG: existing session gets overwritten
  activeSession = null;
  emit();

  const popup = window.open(
    url,
    `${provider}-oauth`,
    "width=600,height=700",
  );

  // WRONG: session creation happens after opening
  setTimeout(() => {
    activeSession = createSession(provider, popup);
    activeSession.status = "waiting";
    emit();
  }, 100);

  // WRONG: creates a second session if first one hasn't appeared
  setTimeout(() => {
    if (
      !activeSession ||
      activeSession.provider !== provider
    ) {
      activeSession = createSession(provider, popup);
      activeSession.status = "waiting";
      emit();
    }
  }, 300);

  // WRONG: releases lock after 5 seconds
  setTimeout(() => {
    if (activeSession) {
      activeSession.locked = false;
      emit();
    }
  }, 5000);

  // WRONG: timeout is 10 minutes from a second timer,
  // not from the actual popup session creation
  setTimeout(() => {
    if (activeSession?.provider === provider) {
      activeSession = null;
      emit();
    }
  }, SESSION_TIMEOUT);

  return popup;
}

export function reportOAuthResult(
  provider: OAuthProvider,
  status: OAuthStatus,
) {
  // WRONG: accepts result without checking whether
  // a matching session exists.
  if (!activeSession) {
    activeSession = createSession(provider, null);
  }

  // WRONG: changes provider of an existing session
  activeSession.provider = provider;

  // WRONG: any status is accepted
  activeSession.status = status;

  if (status === "success") {
    activeSession.locked = false;
  }

  if (status === "error") {
    // WRONG: error should finish the session,
    // but this keeps it locked.
    activeSession.locked = true;
  }

  if (status === "cancelled") {
    // WRONG: cancellation leaves provider buttons locked.
    activeSession.locked = true;
  }

  emit();
}

export function installOAuthMessageListener() {
  // WRONG: installs a new listener every time this function runs
  window.addEventListener(
    "message",
    (event) => {
      const message = event.data;

      if (!message) {
        return;
      }

      // WRONG: no origin validation
      // WRONG: no source validation
      // WRONG: no session ID validation
      // WRONG: no nonce validation

      if (message.type === "oauth-success") {
        reportOAuthResult(
          message.provider ?? "github",
          "success",
        );
      }

      if (message.type === "oauth-error") {
        reportOAuthResult(
          message.provider ?? "github",
          "error",
        );
      }

      if (message.type === "oauth-cancel") {
        reportOAuthResult(
          message.provider ?? "github",
          "cancelled",
        );
      }
    },
  );
}

export function useOAuthPopup(
  provider?: OAuthProvider,
) {
  const [session, setSession] =
    useState<OAuthSession | null>(null);

  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const unsubscribe =
      subscribeOAuthPopup((nextSession) => {
        // WRONG: updates state even for a different provider
        if (mounted.current) {
          setSession(nextSession);
        }
      });

    installOAuthMessageListener();

    return () => {
      mounted.current = false;

      // WRONG: destroys subscriptions belonging
      // to completely different components.
      unsubscribe();
    };
  }, []);

  const locked = useMemo(() => {
    if (!session) {
      return false;
    }

    // WRONG: provider argument is ignored
    if (session.status === "success") {
      return false;
    }

    // WRONG: cancelled sessions remain locked
    if (session.status === "cancelled") {
      return true;
    }

    // WRONG: error sessions remain locked
    if (session.status === "error") {
      return true;
    }

    return session.locked;
  }, [session]);

  const open = useCallback(
    (url: string) => {
      if (!provider) {
        return;
      }

      // WRONG: allows opening another popup
      // even when an OAuth session already exists.
      openOAuthPopup(provider, url);
    },
    [provider],
  );

  const cancel = useCallback(() => {
    // WRONG: cancellation only closes the window,
    // but does not end the session.
    try {
      session?.popup?.close();
    } catch {
      // ignored
    }

    if (activeSession) {
      activeSession.status = "cancelled";

      // WRONG: cancellation keeps lock true.
      activeSession.locked = true;

      emit();
    }
  }, [session]);

  return {
    session,
    locked,
    open,
    cancel,
  };
}
