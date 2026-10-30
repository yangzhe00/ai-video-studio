import "./styles.css";
import { loadRelease, releaseUrl, type ReleaseInfo } from "./release";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function initSite(): void {
  const menuToggle = byId<HTMLButtonElement>("menu-toggle");
  const mobileNav = byId<HTMLElement>("mobile-nav");
  const menuBackdrop = byId<HTMLElement>("menu-backdrop");
  function closeMenu(restoreFocus = true): void {
    mobileNav.hidden = true;
    menuBackdrop.hidden = true;
    menuToggle.setAttribute("aria-expanded", "false");
    menuToggle.setAttribute("aria-label", "打开菜单");
    if (restoreFocus) menuToggle.focus();
  }
  menuToggle.addEventListener("click", () => {
    if (!mobileNav.hidden) return closeMenu();
    mobileNav.hidden = false;
    menuBackdrop.hidden = false;
    menuToggle.setAttribute("aria-expanded", "true");
    menuToggle.setAttribute("aria-label", "关闭菜单");
    mobileNav.querySelector<HTMLElement>("a")?.focus();
  });
  menuBackdrop.addEventListener("click", () => closeMenu());
  mobileNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => closeMenu()));
  window.addEventListener("resize", () => {
    if (window.innerWidth > 800 && !mobileNav.hidden) closeMenu(false);
  });

  const dialog = byId<HTMLDialogElement>("image-dialog");
  const dialogImage = byId<HTMLImageElement>("dialog-image");
  const dialogTitle = byId<HTMLElement>("dialog-title");
  const dialogCaption = byId<HTMLElement>("dialog-caption");
  const dialogClose = byId<HTMLButtonElement>("dialog-close");
  let imageOpener: HTMLButtonElement | null = null;
  document.querySelectorAll<HTMLButtonElement>(".image-open").forEach((button) => {
    button.addEventListener("click", () => {
      imageOpener = button;
      dialogImage.src = button.dataset.image || "";
      dialogImage.alt = button.querySelector("img")?.alt || "产品界面截图";
      dialogTitle.textContent = button.dataset.caption || "产品界面";
      dialogCaption.textContent = button.dataset.caption || "产品界面";
      dialog.showModal();
      dialogClose.focus();
    });
  });
  dialogClose.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => imageOpener?.focus());

  const installationToggle = byId<HTMLButtonElement>("installation-toggle");
  const guide = byId<HTMLElement>("installation-guide");
  installationToggle.addEventListener("click", () => {
    guide.hidden = !guide.hidden;
    installationToggle.setAttribute("aria-expanded", String(!guide.hidden));
    installationToggle.firstChild!.textContent = guide.hidden ? "查看安装说明 " : "收起安装说明 ";
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!mobileNav.hidden) { closeMenu(); return; }
    const active = document.activeElement?.closest("details") as HTMLDetailsElement | null;
    if (active?.open) { active.open = false; active.querySelector("summary")?.focus(); }
  });

  const copyButton = byId<HTMLButtonElement>("copy-hash");
  const hashText = byId<HTMLElement>("release-hash");
  const copyStatus = byId<HTMLElement>("copy-status");
  let activeRelease: ReleaseInfo | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  copyButton.addEventListener("click", async () => {
    if (!activeRelease) return;
    try {
      await navigator.clipboard.writeText(activeRelease.sha256);
      copyStatus.textContent = "已复制";
      copyButton.textContent = "已复制";
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { copyStatus.textContent = ""; copyButton.textContent = "复制 SHA-256"; }, 3000);
    } catch {
      hashText.focus();
      const range = document.createRange();
      range.selectNodeContents(hashText);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      copyStatus.textContent = "复制失败，已选中校验值，可手动复制";
    }
  });

  void loadRelease().then((release) => {
    if (!release) return;
    activeRelease = release;
    byId("release-version").textContent = `v${release.version}`;
    byId("footer-version").textContent = `v${release.version}`;
    byId("release-date").textContent = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(release.publishedAt));
    byId("release-size").textContent = `${(release.bytes / 1024 / 1024).toFixed(1)} MiB`;
    const state = byId("release-state");
    state.textContent = "可下载";
    state.className = "status-available";
    byId("release-detail").textContent = "下载前请确认芯片与安装说明";
    hashText.textContent = release.sha256;
    const download = byId<HTMLAnchorElement>("download-link");
    download.href = releaseUrl(release);
    download.download = release.filename;
    download.textContent = "下载 DMG ↗";
    download.classList.remove("is-disabled");
    download.removeAttribute("aria-disabled");
    download.removeAttribute("tabindex");
    copyButton.disabled = false;
  });
}

if (document.getElementById("menu-toggle")) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initSite, { once: true });
  else initSite();
}
