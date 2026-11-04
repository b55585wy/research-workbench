import { useEffect, useRef, useState } from "react";

type GuestLanguage = "zh" | "en";

interface GuestAccess {
  mode: "guest";
  workspace_id: string;
  storage: "server";
  registration_available: boolean;
  recovery_available: boolean;
  model_policy: string;
}

type AccessState =
  | { kind: "loading" }
  | { kind: "local" }
  | { kind: "device" }
  | { kind: "guest"; access: GuestAccess }
  | { kind: "unavailable" };

function isDeviceStorage() {
  return window.location.pathname.startsWith("/device/")
    || document.documentElement.dataset.storageMode === "device";
}

type DialogStatus = {
  kind: "info" | "error";
  text: string;
} | null;

const guestStrings = {
  zh: {
    localGuest: "本地游客",
    localGuestTitle: "无需登录；数据保存在运行此工作台的电脑上。",
    guestSpace: "游客空间",
    guestSpaceTitle: "查看游客空间保存与恢复方式",
    accessUnavailable: "游客空间状态不可用",
    dialogTitle: "游客空间",
    close: "关闭",
    explanation: "空间保存在服务器上，此浏览器会返回同一空间。清除浏览器数据或更换设备时需要恢复码；账户绑定将在后续提供。",
    modelPolicy: "模型连接需使用你自己的 Key。",
    codeHelp: "恢复码只在你主动生成后显示，请离线妥善保存。",
    saveCode: "保存恢复码",
    generating: "正在生成…",
    regenerate: "重新生成恢复码",
    rotationWarning: "生成新恢复码后，当前恢复码将立即失效。确定要继续吗？",
    confirmRotation: "生成新恢复码",
    cancelRotation: "保留当前恢复码",
    codeLabel: "恢复码",
    codeReady: "恢复码已生成。请立即保存；再次生成会使它失效。",
    copy: "复制",
    copied: "恢复码已复制。",
    copyManual: "无法自动复制。请手动选择并复制上方恢复码。",
    download: "下载 TXT",
    downloaded: "恢复码已下载为纯文本文件。",
    generationFailed: "暂时无法生成恢复码，请稍后重试。",
    recoveryUnavailable: "当前空间暂不支持恢复码。",
    recover: "找回已有空间"
  },
  en: {
    localGuest: "Local guest",
    localGuestTitle: "No login required; data is saved on the computer running this workspace.",
    guestSpace: "Guest space",
    guestSpaceTitle: "How your guest space is saved and recovered",
    accessUnavailable: "Guest space status unavailable",
    dialogTitle: "Guest space",
    close: "Close",
    explanation: "Your space is saved on the server, and this browser returns to the same space. Clearing browser data or switching devices requires a recovery code; account binding will come later.",
    modelPolicy: "Model connections use your own key.",
    codeHelp: "A recovery code appears only when you explicitly generate one. Keep it safe offline.",
    saveCode: "Save recovery code",
    generating: "Generating…",
    regenerate: "Generate a new code",
    rotationWarning: "Generating a new code will immediately invalidate the current one. Continue?",
    confirmRotation: "Generate new code",
    cancelRotation: "Keep current code",
    codeLabel: "Recovery code",
    codeReady: "Your recovery code is ready. Save it now; generating another will invalidate it.",
    copy: "Copy",
    copied: "Recovery code copied.",
    copyManual: "Automatic copy is blocked. Select and copy the recovery code above manually.",
    download: "Download TXT",
    downloaded: "Recovery code downloaded as a plain-text file.",
    generationFailed: "The recovery code could not be generated. Try again later.",
    recoveryUnavailable: "Recovery codes are not available for this space.",
    recover: "Recover an existing space"
  }
} as const;

function parseGuestAccess(value: unknown): GuestAccess | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.mode !== "guest"
    || typeof candidate.workspace_id !== "string"
    || candidate.storage !== "server"
    || typeof candidate.registration_available !== "boolean"
    || typeof candidate.recovery_available !== "boolean"
    || typeof candidate.model_policy !== "string"
  ) return null;
  return {
    mode: "guest",
    workspace_id: candidate.workspace_id,
    storage: "server",
    registration_available: candidate.registration_available,
    recovery_available: candidate.recovery_available,
    model_policy: candidate.model_policy
  };
}

export function GuestIdentity({ language }: { language: GuestLanguage }) {
  const copy = guestStrings[language];
  const [accessState, setAccessState] = useState<AccessState>(() => ({ kind: isDeviceStorage() ? "device" : "loading" }));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [rotationPending, setRotationPending] = useState(false);
  const [status, setStatus] = useState<DialogStatus>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generationRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isDeviceStorage()) {
      setAccessState({ kind: "device" });
      return;
    }
    const controller = new AbortController();
    let active = true;

    async function loadAccess() {
      try {
        const response = await fetch("/api/v1/access", {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!active || controller.signal.aborted) return;
        if (response.status === 404) {
          setAccessState({ kind: "local" });
          return;
        }
        if (!response.ok) {
          setAccessState({ kind: "unavailable" });
          return;
        }
        const access = parseGuestAccess(await response.json());
        if (!active || controller.signal.aborted) return;
        setAccessState(access ? { kind: "guest", access } : { kind: "unavailable" });
      } catch {
        if (active && !controller.signal.aborted) setAccessState({ kind: "unavailable" });
      }
    }

    void loadAccess();
    return () => {
      active = false;
      controller.abort();
      generationRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  function openDialog() {
    setStatus(null);
    setRotationPending(false);
    setOpen(true);
  }

  function closeDialog() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else setOpen(false);
  }

  function handleDialogClose() {
    generationRef.current?.abort();
    generationRef.current = null;
    setOpen(false);
    setBusy(false);
    setRecoveryCode(null);
    setRotationPending(false);
    setStatus(null);
    badgeRef.current?.focus({ preventScroll: true });
  }

  async function generateRecoveryCode() {
    if (busy) return;
    const controller = new AbortController();
    generationRef.current?.abort();
    generationRef.current = controller;
    setBusy(true);
    setStatus(null);
    setRotationPending(false);

    try {
      const response = await fetch("/api/v1/access/recovery-code", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal
      });
      const payload: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      const code = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).recovery_code
        : null;
      if (!response.ok || typeof code !== "string" || !code) {
        setStatus({ kind: "error", text: copy.generationFailed });
        return;
      }
      setRecoveryCode(code);
      setStatus({ kind: "info", text: copy.codeReady });
    } catch {
      if (!controller.signal.aborted) {
        setStatus({ kind: "error", text: copy.generationFailed });
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        generationRef.current = null;
      }
    }
  }

  async function copyRecoveryCode() {
    if (!recoveryCode || busy) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(recoveryCode);
      if (dialogRef.current?.open) setStatus({ kind: "info", text: copy.copied });
    } catch {
      if (dialogRef.current?.open) setStatus({ kind: "error", text: copy.copyManual });
    }
  }

  function downloadRecoveryCode() {
    if (!recoveryCode || busy) return;
    const blob = new Blob([`research workspace recovery code\n\n${recoveryCode}\n`], {
      type: "text/plain;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "research-workspace-recovery-code.txt";
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus({ kind: "info", text: copy.downloaded });
  }

  return (
    <>
      <span className="brand-name">research workspace</span>
      {accessState.kind === "device" && (
        <span className="local-guest" title={language === "zh" ? "资料仅保存在此浏览器中。" : "Papers are stored only in this browser."}>
          {language === "zh" ? "本机资料" : "On this device"}
        </span>
      )}
      {accessState.kind === "local" && (
        <span className="local-guest" title={copy.localGuestTitle}>{copy.localGuest}</span>
      )}
      {accessState.kind === "unavailable" && (
        <span className="local-guest guest-access-unavailable" role="status">{copy.accessUnavailable}</span>
      )}
      {accessState.kind === "guest" && (
        <>
          <button
            ref={badgeRef}
            className="local-guest guest-space-badge"
            type="button"
            title={copy.guestSpaceTitle}
            aria-haspopup="dialog"
            aria-controls="guest-access-dialog"
            aria-expanded={open}
            onClick={openDialog}
          >
            {copy.guestSpace}
          </button>
          <dialog
            ref={dialogRef}
            id="guest-access-dialog"
            className="guest-access-dialog"
            aria-labelledby="guest-access-dialog-title"
            aria-describedby="guest-access-dialog-description"
            onClose={handleDialogClose}
          >
            <div className="guest-access-dialog-heading">
              <h2 id="guest-access-dialog-title">{copy.dialogTitle}</h2>
              <button className="button button-quiet" type="button" onClick={closeDialog} autoFocus>
                {copy.close}
              </button>
            </div>
            <p id="guest-access-dialog-description" className="guest-access-explanation">{copy.explanation}</p>
            {accessState.access.model_policy === "personal_key" && (
              <p className="guest-access-model">{copy.modelPolicy}</p>
            )}
            {accessState.access.recovery_available ? (
              <div className="guest-access-recovery">
                <p className="guest-access-code-help">{copy.codeHelp}</p>
                {recoveryCode && (
                  <code className="guest-access-code" aria-label={copy.codeLabel} tabIndex={0}>
                    {recoveryCode}
                  </code>
                )}
                {rotationPending && (
                  <div className="guest-access-rotation" role="alert">
                    <p>{copy.rotationWarning}</p>
                    <div className="guest-access-actions">
                      <button className="button button-primary" type="button" disabled={busy} onClick={() => void generateRecoveryCode()}>
                        {busy ? copy.generating : copy.confirmRotation}
                      </button>
                      <button className="button button-quiet" type="button" disabled={busy} onClick={() => setRotationPending(false)}>
                        {copy.cancelRotation}
                      </button>
                    </div>
                  </div>
                )}
                {!rotationPending && (
                  <div className="guest-access-actions">
                    <button
                      className={recoveryCode ? "button button-secondary" : "button button-primary"}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (recoveryCode) setRotationPending(true);
                        else void generateRecoveryCode();
                      }}
                    >
                      {busy ? copy.generating : recoveryCode ? copy.regenerate : copy.saveCode}
                    </button>
                    {recoveryCode && (
                      <>
                        <button className="button button-secondary" type="button" disabled={busy} onClick={() => void copyRecoveryCode()}>
                          {copy.copy}
                        </button>
                        <button className="button button-secondary" type="button" disabled={busy} onClick={downloadRecoveryCode}>
                          {copy.download}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : <p className="guest-access-status" data-kind="error">{copy.recoveryUnavailable}</p>}
            <p className="guest-access-status" data-kind={status?.kind || "info"} role={status?.kind === "error" ? "alert" : "status"} aria-live="polite">
              {status?.text || ""}
            </p>
            <a className="guest-access-recover-link" href="/recover.html">{copy.recover}</a>
          </dialog>
        </>
      )}
    </>
  );
}
