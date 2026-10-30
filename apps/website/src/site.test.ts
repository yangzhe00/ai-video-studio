import { beforeEach, describe, expect, it, vi } from "vitest";
import html from "../index.html?raw";

const { loadReleaseMock } = vi.hoisted(() => ({ loadReleaseMock: vi.fn() }));
vi.mock("./release", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./release")>();
  return { ...actual, loadRelease: loadReleaseMock };
});

const { initSite } = await import("./main");

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
  loadReleaseMock.mockReset().mockResolvedValue(null);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  initSite();
});

describe("official website", () => {
  it("leads with self-written content while the three Agent directions are unavailable", () => {
    const headline = document.getElementById("hero-title")?.textContent || "";
    const hero = document.querySelector(".hero")?.textContent || "";
    expect(headline).toContain("写下想法或剧本");
    expect(headline).toContain("从一个镜头开始");
    expect(headline).not.toContain("镜头方向");
    expect(hero).toContain("Agent 三版镜头方向即将开放");
    expect(hero).not.toContain("测试中");
    expect(document.querySelector(".storyboard-label")?.textContent).toContain("自己安排每个镜头");
    expect(document.querySelector(".faq-list details:nth-child(2)")?.textContent).toContain("即将开放");
  });
  it("sends all creation CTAs to /studio/ and the hero download CTA to the explanation", () => {
    expect([...document.querySelectorAll<HTMLAnchorElement>('a[href="/studio/"]')].length).toBeGreaterThanOrEqual(4);
    expect(document.querySelector<HTMLAnchorElement>(".hero-actions a:last-child")?.getAttribute("href")).toBe("#download");
    expect(document.querySelectorAll('a[href="#features"],a[href="#workflow"],a[href="#download"],a[href="#faq"]').length).toBeGreaterThanOrEqual(8);
  });
  it("pairs each capability with a labeled, enlargeable product screenshot", () => {
    const features = [...document.querySelectorAll<HTMLElement>(".feature")];
    expect(features).toHaveLength(4);
    for (const feature of features) {
      const button = feature.querySelector<HTMLButtonElement>(".feature-thumb");
      expect(button?.dataset.image).toMatch(/^\/media\//);
      expect(button?.getAttribute("aria-label")).toContain("放大查看");
      expect(feature.querySelector("img")?.alt.length).toBeGreaterThan(8);
    }
  });
  it("keeps download unavailable with no manifest", async () => {
    await Promise.resolve();
    const link = document.getElementById("download-link") as HTMLAnchorElement;
    expect(link.hasAttribute("href")).toBe(false);
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect((document.getElementById("copy-hash") as HTMLButtonElement).disabled).toBe(true);
  });
  it("opens and closes the mobile menu with Escape and restores focus", () => {
    const toggle = document.getElementById("menu-toggle") as HTMLButtonElement;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect((document.getElementById("mobile-nav") as HTMLElement).hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });
  it("opens an actual screenshot in a modal and returns focus to its opener", () => {
    const opener = document.querySelector<HTMLButtonElement>(".image-open")!;
    opener.click();
    const dialog = document.getElementById("image-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect((document.getElementById("dialog-image") as HTMLImageElement).getAttribute("src")).toContain("desktop-home");
    (document.getElementById("dialog-close") as HTMLButtonElement).click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
  it("opens installation guidance and FAQ with native keyboard controls", () => {
    const install = document.getElementById("installation-toggle") as HTMLButtonElement;
    install.click();
    expect(install.getAttribute("aria-expanded")).toBe("true");
    expect((document.getElementById("installation-guide") as HTMLElement).hidden).toBe(false);
    const faq = document.querySelector<HTMLDetailsElement>(".faq-list details")!;
    faq.open = true;
    faq.querySelector("summary")?.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(faq.open).toBe(false);
  });
  it("copies the published hash and provides selectable text if clipboard access is denied", async () => {
    await Promise.resolve();
    const sha256 = "b".repeat(64);
    loadReleaseMock.mockResolvedValue({
      version: "0.2.0", platform: "macos-arm64", filename: "AI-Video-Studio-0.2.0-macos-arm64.dmg",
      bytes: 4194304, sha256, publishedAt: "2026-10-30T12:00:00Z",
    });
    initSite();
    await Promise.resolve();
    const copy = document.getElementById("copy-hash") as HTMLButtonElement;
    expect(copy.disabled).toBe(false);
    expect((document.getElementById("download-link") as HTMLAnchorElement).getAttribute("href")).toBe("/downloads/AI-Video-Studio-0.2.0-macos-arm64.dmg");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    copy.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(sha256);
    expect(document.getElementById("copy-status")?.textContent).toBe("已复制");
    writeText.mockRejectedValueOnce(new Error("denied"));
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.getElementById("copy-status")?.textContent).toContain("可手动复制");
    expect(window.getSelection()?.toString()).toBe(sha256);
  });
});
