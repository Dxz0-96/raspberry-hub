"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronLeft, CircleAlert, KeyRound, Lock, LogOut, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { errorMessage, useHub } from "@/lib/hub";
import { duration } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { Dialog } from "./Dialog";

function ThemePicker() {
  const { choice, set } = useTheme();
  const { t } = useI18n();
  const themes: { value: ThemeChoice; name: string; Icon: typeof Sun }[] = [
    { value: "browser", name: t.header.themeBrowser, Icon: Monitor },
    { value: "light", name: t.header.themeLight, Icon: Sun },
    { value: "dark", name: t.header.themeDark, Icon: Moon },
  ];
  return (
    <div className="picker" role="group" aria-label={t.header.theme}>
      {themes.map(({ value, name, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          aria-label={t.header.themeButton(name)}
          title={name}
          onClick={() => set(value)}
        >
          <Icon size={17} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ChangePassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { changePassword } = useHub();
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setRepeated("");
      setError(null);
    }
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return setError(t.password.enterCurrent);
    if (next.length < 8) return setError(t.password.tooShort);
    if (next !== repeated) return setError(t.password.mismatch);
    setSending(true);
    setError(null);
    try {
      await changePassword(current, next);
      onClose();
    } catch (problem) {
      setError(errorMessage(t, problem, t.password.failed));
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t.password.title}>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="pw-current">{t.password.current}</label>
          <input id="pw-current" type="password" autoComplete="current-password" value={current}
            onChange={(e) => { setCurrent(e.target.value); setError(null); }} />
        </div>
        <div className="field">
          <label htmlFor="pw-new">{t.password.new}</label>
          <input id="pw-new" type="password" autoComplete="new-password" value={next}
            aria-describedby="pw-new-hint" onChange={(e) => { setNext(e.target.value); setError(null); }} />
          <p className="field-hint" id="pw-new-hint">{t.password.newHint}</p>
        </div>
        <div className="field">
          <label htmlFor="pw-repeated">{t.password.repeat}</label>
          <input id="pw-repeated" type="password" autoComplete="new-password" value={repeated}
            onChange={(e) => { setRepeated(e.target.value); setError(null); }} />
        </div>
        {error && (
          <p className="error-box" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" className="button primary" disabled={sending}>
            {sending ? t.password.saving : t.password.submit}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Session() {
  const { authenticated, user, openLogin, logOut } = useHub();
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [password, setPassword] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);

  if (!authenticated) {
    return (
      <button type="button" className="button" onClick={() => openLogin()}>
        <Lock size={17} aria-hidden="true" />
        {t.header.logIn}
      </button>
    );
  }
  return (
    <div className="session" ref={ref}>
      <button type="button" className="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <UserRound size={17} aria-hidden="true" />
        {user}
      </button>
      {menu && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); setPassword(true); }}>
            <KeyRound size={17} aria-hidden="true" />
            {t.header.changePassword}
          </button>
          <button type="button" role="menuitem" onClick={() => { setMenu(false); void logOut(); }}>
            <LogOut size={17} aria-hidden="true" />
            {t.header.logOut}
          </button>
        </div>
      )}
      <ChangePassword open={password} onClose={() => setPassword(false)} />
    </div>
  );
}

/** The header of every page: name of the Raspberry Pi, how it is doing, login and theme. (The language follows the
 *  browser: lib/i18n.tsx.) */
export function Header({ title, back = false }: { title?: string; back?: boolean }) {
  const { system } = useHub();
  const { t, locale } = useI18n();
  const model = system?.model.replace(/^Raspberry\s+/i, "").replace(/\s+Rev.*$/i, "");
  return (
    <header className="topbar">
      <div className="topbar-inner">
        {back && (
          <Link href="/" className="back">
            <ChevronLeft size={18} aria-hidden="true" />
            {t.common.hub}
          </Link>
        )}
        <div className="topbar-name">
          <h1>{title ?? "raspberry"}</h1>
          <p className="topbar-sub">
            {system && model
              ? t.header.subtitle(model, system.ip, duration(system.uptime, locale))
              : t.common.waitingForData}
          </p>
        </div>
        <div className="topbar-actions">
          <Session />
          <ThemePicker />
        </div>
      </div>
    </header>
  );
}
