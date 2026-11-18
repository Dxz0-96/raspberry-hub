"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CircleAlert } from "lucide-react";
import { ApiError, errorMessage, useHub } from "@/lib/hub";
import { useI18n } from "@/lib/i18n";
import { Dialog } from "./Dialog";

type LoginError =
  | { kind: "credentials"; attemptsLeft: number }
  | { kind: "locked"; minutes: number }
  | { kind: "other"; problem: unknown };

/** The login dialog with username and password. Opens when needed: switches, adding services. */
export function LoginDialog() {
  const { loginOpen, closeLogin, logIn, configured } = useHub();
  const { t } = useI18n();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [usernameMissing, setUsernameMissing] = useState(false);
  const [passwordMissing, setPasswordMissing] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [sending, setSending] = useState(false);
  const passwordField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loginOpen) return;
    setPassword("");
    setError(null);
    setUsernameMissing(false);
    setPasswordMissing(false);
    try {
      const last = localStorage.getItem("username");
      if (last) setUsername(last);
    } catch {
      // no storage: the default name stays
    }
    const timer = setTimeout(() => passwordField.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [loginOpen]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    setUsernameMissing(!name);
    setPasswordMissing(!password);
    if (!name || !password) return;
    setSending(true);
    setError(null);
    try {
      await logIn(name, password);
      try {
        localStorage.setItem("username", name);
      } catch {
        // never mind: next time "admin" shows up again
      }
    } catch (problem) {
      setPassword("");
      passwordField.current?.focus();
      if (problem instanceof ApiError && problem.code === "bad_credentials") {
        setError({ kind: "credentials", attemptsLeft: Number(problem.data.attempts_left ?? 0) });
      } else if (problem instanceof ApiError && problem.code === "locked") {
        setError({ kind: "locked", minutes: Math.max(1, Math.ceil(Number(problem.data.seconds ?? 300) / 60)) });
      } else {
        setError({ kind: "other", problem });
      }
    } finally {
      setSending(false);
    }
  }

  const errorText =
    error?.kind === "credentials"
      ? t.login.badCredentials(error.attemptsLeft)
      : error?.kind === "locked"
        ? t.login.locked(error.minutes)
        : error
          ? errorMessage(t, error.problem, t.login.failed)
          : null;

  return (
    <Dialog open={loginOpen} onClose={closeLogin} title={t.login.title}>
      {configured ? (
        <form onSubmit={submit} noValidate>
          <p className="dialog-intro">{t.login.intro}</p>
          <div className="field">
            <label htmlFor="login-username">{t.login.username}</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              aria-invalid={usernameMissing}
              aria-describedby={usernameMissing ? "login-username-error" : undefined}
              onChange={(e) => {
                setUsername(e.target.value);
                setUsernameMissing(false);
              }}
            />
            {usernameMissing && (
              <p className="field-error" id="login-username-error">
                {t.login.enterUsername}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="login-password">{t.login.password}</label>
            <input
              id="login-password"
              ref={passwordField}
              type="password"
              autoComplete="current-password"
              value={password}
              aria-invalid={passwordMissing}
              aria-describedby={passwordMissing ? "login-password-error" : undefined}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordMissing(false);
                setError(null);
              }}
            />
            {passwordMissing && (
              <p className="field-error" id="login-password-error">
                {t.login.enterPassword}
              </p>
            )}
          </div>
          {errorText && (
            <p className="error-box" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{errorText}</span>
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={closeLogin}>
              {t.common.cancel}
            </button>
            <button type="submit" className="button primary" disabled={sending}>
              {sending ? t.login.submitting : t.login.submit}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <p className="dialog-intro">{t.login.notConfigured}</p>
          <pre className="command">sudo hub-control-setpass</pre>
          <div className="dialog-actions">
            <button type="button" className="button primary" onClick={closeLogin}>
              {t.login.gotIt}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
