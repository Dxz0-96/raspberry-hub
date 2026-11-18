"use client";

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { CircleAlert, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { BASE, errorMessage, useHub } from "@/lib/hub";
import { dayMonth, monthYear } from "@/lib/format";
import { useI18n, type Locale } from "@/lib/i18n";
import type { Messages } from "@/lib/messages/en";
import type { ContentStatus, LiveState, Service } from "@/lib/types";
import { Dialog } from "./Dialog";

type Tone = "ok" | "idle" | "fault";

/** Icons live on the Raspberry Pi (/icons/...): in development they come from the mock Raspberry Pi. */
function iconUrl(icon: string): string {
  return icon.startsWith("/icons/") ? BASE + icon : icon;
}

/** Built-in services are labelled by the hub, in the page language; added ones as they were typed. */
function label(s: Service, t: Messages): { name: string; description: string } {
  const builtIn = t.services.builtIn[s.id];
  return builtIn && !s.added ? builtIn : { name: s.name, description: s.description ?? "" };
}

/** The line under the name: the state when there is something to say, otherwise the description. */
function statusLine(
  s: Service,
  live: LiveState | undefined,
  content: ContentStatus | null,
  t: Messages,
  locale: Locale,
): { text: string; tone: Tone } {
  const description = label(s, t).description;
  if (!live) return { text: description, tone: "ok" };
  const detail = live.detail ? t.services.details[live.detail]?.(live.host ?? "") ?? "" : "";
  const downloadable = s.id === "wikipedia" ? content?.wikipedia : s.id === "maps" ? content?.maps : null;
  switch (live.state) {
    case "off":
      return { text: t.services.off(s.id), tone: "idle" };
    case "paused":
      return { text: t.services.paused, tone: "idle" };
    case "missing":
      if (downloadable?.running) return { text: t.services.downloading, tone: "idle" };
      if (downloadable?.result?.startsWith("error")) return { text: t.services.downloadFailed, tone: "fault" };
      return { text: t.services.notDownloaded, tone: "idle" };
    case "unreachable":
      return { text: detail || t.services.unreachable, tone: "fault" };
    case "error":
      return { text: detail || t.services.error, tone: "fault" };
    case "unknown":
      return { text: detail || t.services.unknown, tone: "idle" };
    default: {
      if (s.id === "pihole") return { text: t.services.blockingOn, tone: "ok" };
      if (s.id === "wikipedia") {
        const edition = monthYear(content?.wikipedia.edition, locale);
        const text = edition ? t.services.edition(edition) : description;
        return { text: content?.wikipedia.running ? t.services.updating(text) : text, tone: "ok" };
      }
      if (s.id === "maps") {
        const day = dayMonth(content?.maps.build, locale);
        const text = day ? t.services.mapsUpdated(day) : description;
        return { text: detail ? `${text}. ${detail}` : text, tone: "ok" };
      }
      return { text: description, tone: "ok" };
    }
  }
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function ServiceIcon({ service, name }: { service: Service; name: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [service.icon]);
  if (!service.icon || broken) {
    return (
      <span className="service-icon initial" aria-hidden="true">
        {initial(name)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="service-icon" src={iconUrl(service.icon)} alt="" width={48} height={48} onError={() => setBroken(true)} />;
}

function Switch({
  on,
  busy,
  label,
  onChange,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy}
      disabled={busy}
      onClick={() => onChange(!on)}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </button>
  );
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function ServiceForm({ service, open, onClose }: { service: Service | null; open: boolean; onClose: () => void }) {
  const { saveService, removeService } = useHub();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState<{ data: string; preview: string } | null>(null);
  const [errors, setErrors] = useState<{ name?: string; url?: string; icon?: string; general?: string }>({});
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(service?.name ?? "");
    setDescription(service?.description ?? "");
    setUrl(service?.url ?? "");
    setIcon(null);
    setErrors({});
    setConfirming(false);
  }, [open, service]);

  function pickImage(file: File | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setErrors((e) => ({ ...e, icon: t.apiErrors.icon_format }));
      return;
    }
    if (file.size > 512 * 1024) {
      setErrors((e) => ({ ...e, icon: t.apiErrors.icon_too_large }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setIcon({ data: dataUrl.slice(dataUrl.indexOf(",") + 1), preview: dataUrl });
      setErrors((e) => ({ ...e, icon: undefined }));
    };
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    const address = url.trim();
    if (!name.trim()) found.name = t.serviceForm.nameMissing;
    if (!address) found.url = t.serviceForm.urlMissing;
    else if (!/^(https?:\/\/\S+|\/\S*)$/.test(address)) found.url = t.apiErrors.invalid_url;
    setErrors(found);
    if (found.name || found.url) return;
    setSending(true);
    try {
      await saveService(
        { name: name.trim(), description: description.trim(), url: address, ...(icon ? { icon: { data: icon.data } } : {}) },
        service?.id,
      );
      onClose();
    } catch (problem) {
      setErrors({ general: errorMessage(t, problem, t.serviceForm.saveFailed) });
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    if (!service) return;
    if (!confirming) return setConfirming(true);
    setSending(true);
    try {
      await removeService(service.id);
      onClose();
    } catch (problem) {
      setErrors({ general: errorMessage(t, problem, t.serviceForm.removeFailed) });
    } finally {
      setSending(false);
    }
  }

  const preview = icon?.preview ?? (service?.icon ? iconUrl(service.icon) : undefined);
  return (
    <Dialog open={open} onClose={onClose} title={service ? t.serviceForm.titleEdit : t.serviceForm.titleAdd}>
      <form onSubmit={submit} noValidate>
        {!service && <p className="dialog-intro">{t.serviceForm.intro}</p>}
        <div className="field">
          <label htmlFor="service-name">{t.serviceForm.name}</label>
          <input id="service-name" type="text" maxLength={40} placeholder={t.serviceForm.namePlaceholder} value={name}
            aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "service-name-error" : undefined}
            onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} />
          {errors.name && <p className="field-error" id="service-name-error">{errors.name}</p>}
        </div>
        <div className="field">
          <label htmlFor="service-url">{t.serviceForm.url}</label>
          <input id="service-url" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={280}
            placeholder={t.serviceForm.urlPlaceholder} value={url}
            aria-invalid={Boolean(errors.url)} aria-describedby={errors.url ? "service-url-error" : undefined}
            onChange={(e) => { setUrl(e.target.value); setErrors((x) => ({ ...x, url: undefined })); }} />
          {errors.url && <p className="field-error" id="service-url-error">{errors.url}</p>}
        </div>
        <div className="field">
          <label htmlFor="service-description">{t.serviceForm.description}</label>
          <input id="service-description" type="text" maxLength={80} placeholder={t.serviceForm.descriptionPlaceholder}
            value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label" id="service-icon-label">{t.serviceForm.icon}</span>
          <div className="icon-picker">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="service-icon" src={preview} alt="" width={48} height={48} />
            ) : (
              <span className="service-icon initial" aria-hidden="true">{initial(name)}</span>
            )}
            <input ref={fileField} type="file" accept={IMAGE_TYPES.join(",")} hidden
              onChange={(e) => pickImage(e.target.files?.[0])} />
            <button type="button" className="button" aria-describedby="service-icon-hint"
              onClick={() => fileField.current?.click()}>
              <ImagePlus size={17} aria-hidden="true" />
              {preview ? t.serviceForm.changeImage : t.serviceForm.chooseImage}
            </button>
          </div>
          <p className="field-hint" id="service-icon-hint">{t.serviceForm.iconHint}</p>
          {errors.icon && <p className="field-error">{errors.icon}</p>}
        </div>
        {errors.general && (
          <p className="error-box" role="alert">
            <CircleAlert size={18} aria-hidden="true" />
            <span>{errors.general}</span>
          </p>
        )}
        <div className="dialog-actions">
          {service && (
            <button type="button" className="button danger push-start" disabled={sending} onClick={remove}>
              <Trash2 size={17} aria-hidden="true" />
              {confirming ? t.serviceForm.confirmRemove : t.serviceForm.remove}
            </button>
          )}
          <button type="button" className="button" onClick={onClose}>{t.common.cancel}</button>
          <button type="submit" className="button primary" disabled={sending}>
            {service ? t.serviceForm.save : t.serviceForm.submitAdd}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The list of services: each row is connected to the board by a trace that shows its state. */
export function Services() {
  const { services, states, content, authenticated, busy, setSwitch, openLogin } = useHub();
  const { t, locale } = useI18n();
  const [form, setForm] = useState<{ service: Service | null } | null>(null);

  function withLogin(action: () => void) {
    if (authenticated) action();
    else openLogin(action);
  }

  if (services === null) {
    return <p className="services-loading">{t.services.loading}</p>;
  }

  return (
    <section className="services" aria-label={t.services.label}>
      <ul className="services-list">
        {services.map((s, index) => {
          const live = states?.[s.id];
          const { name } = label(s, t);
          const { text, tone } = statusLine(s, live, content, t, locale);
          const openable = !live || !["off", "missing"].includes(live.state);
          const external = /^https?:\/\//.test(s.url);
          const spoken = text ? `${name}, ${text}` : name;
          const inner = (
            <>
              <ServiceIcon service={s} name={name} />
              <span className="row-text">
                <span className="row-name">{name}</span>
                {text && <span className="row-status">{text}</span>}
              </span>
            </>
          );
          return (
            <li key={s.id} className={`row ${tone}${openable ? "" : " closed"}`} data-service={s.id}
              style={{ "--i": index } as CSSProperties}>
              {/* the branch off the backbone: the pulses running along it are drawn by TrafficFlow */}
              <span className="branch" aria-hidden="true" />
              {!openable ? (
                <div className="row-link" role="link" aria-disabled="true" aria-label={spoken}>{inner}</div>
              ) : external ? (
                <a className="row-link" href={s.url} target="_blank" rel="noopener noreferrer"
                  aria-label={`${spoken}${t.common.opensInNewTab}`}>{inner}</a>
              ) : /^\/(maps|wikipedia|hardware)(\/|$)/.test(s.url) ? (
                <Link className="row-link" href={s.url} aria-label={spoken}>{inner}</Link>
              ) : (
                <a className="row-link" href={s.url} aria-label={spoken}>{inner}</a>
              )}
              {s.added && authenticated && (
                <button type="button" className="icon-button" aria-label={t.services.edit(name)}
                  onClick={() => setForm({ service: s })}>
                  <Pencil size={17} aria-hidden="true" />
                </button>
              )}
              {live?.switch && (
                <Switch
                  on={live.state === "on"}
                  busy={Boolean(busy[s.id])}
                  label={s.id === "pihole" ? t.services.adBlocking : name}
                  onChange={(on) => withLogin(() => void setSwitch(s.id, on))}
                />
              )}
            </li>
          );
        })}
      </ul>
      {states === null && (
        <p className="services-note">
          <CircleAlert size={16} aria-hidden="true" />
          {t.services.statusMissing}
        </p>
      )}
      <button type="button" className="button add" onClick={() => withLogin(() => setForm({ service: null }))}>
        <Plus size={18} aria-hidden="true" />
        {t.services.add}
      </button>
      <ServiceForm service={form?.service ?? null} open={form !== null} onClose={() => setForm(null)} />
    </section>
  );
}
