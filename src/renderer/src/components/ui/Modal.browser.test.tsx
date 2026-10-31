import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createSignal, flush, onSettled } from "solid-js";
import { render } from "@solidjs/web";
import { dialogExitMs } from "../../motion";
// The exit beat is a CSS animation, so the test has to load the real sheet.
import "../../styles.css";
import { Modal } from "./Modal";

// Use real Chromium dialogs and Solid's JSX compiler/render pipeline: a DOM
// mock that attaches the element before invoking ref would miss this regression.
describe("Modal mounting", () => {
  let container: HTMLDivElement;
  let launcher: HTMLButtonElement;
  let dispose: (() => void) | undefined;
  let reducedMotion: boolean;

  beforeEach(() => {
    reducedMotion = false;
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) => {
      const result = matchMedia(query);
      if (query === "(prefers-reduced-motion: reduce)") {
        Object.defineProperty(result, "matches", { value: reducedMotion });
      }
      return result;
    });
    container = document.createElement("div");
    launcher = document.createElement("button");
    launcher.textContent = "Open";
    document.body.append(launcher, container);
    launcher.focus();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    container.remove();
    launcher.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const mount = (initialOpen = false) => {
    const [open, setOpen] = createSignal(initialOpen);
    const onClose = vi.fn(() => setOpen(false));
    dispose = render(
      () => (
        <Modal open={open()} title="Test dialog" onClose={onClose}>
          <input aria-label="Address" />
        </Modal>
      ),
      container,
    );
    return { setOpen, onClose };
  };

  const dialog = (): HTMLDialogElement => {
    const element = container.querySelector("dialog");
    expect(element).not.toBeNull();
    return element!;
  };

  // The backdrop is a top-layer pseudo-element: it leaves the frame the moment
  // the dialog closes, so its exit has to run on the dialog's own exit beat.
  const backdropExit = (): ReadonlyArray<CSSAnimation> =>
    document
      .getAnimations()
      .filter(
        (animation): animation is CSSAnimation =>
          animation instanceof CSSAnimation &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.pseudoElement === "::backdrop" &&
          animation.animationName === "fade-out",
      );

  it("native showModal rejects a disconnected element", () => {
    const element = document.createElement("dialog");
    expect(element.isConnected).toBe(false);
    expect(() => element.showModal()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
  });

  it("Solid refs run detached, while onSettled runs after insertion", () => {
    const connections: boolean[] = [];
    dispose = render(
      () => (
        <dialog
          ref={(element) => {
            connections.push(element.isConnected);
            expect(() => element.showModal()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
            onSettled(() => {
              connections.push(element.isConnected);
              element.showModal();
            });
          }}
        />
      ),
      container,
    );
    expect(connections).toEqual([false, true]);
    expect(dialog().matches(":modal")).toBe(true);
    dialog().close();
  });

  it("opens an initially visible dialog only after connection and focuses inside", () => {
    // The spy calls the native method, which would throw if still detached.
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    mount(true);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog().open).toBe(true);
    expect(dialog().matches(":modal")).toBe(true);
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("opens each new branch and keeps the modal alive through its exit beat", () => {
    vi.useFakeTimers();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { setOpen } = mount();
    expect(container.querySelector("dialog")).toBeNull();
    for (let cycle = 0; cycle < 2; cycle++) {
      setOpen(true);
      flush();
      const element = dialog();
      expect(element.matches(":modal")).toBe(true);
      setOpen(false);
      flush();
      expect(dialog()).toBe(element);
      expect(element.matches(":modal")).toBe(true);
      expect(container.querySelector(".modal-layer--closing")).not.toBeNull();
      expect(element.classList.contains("modal--closing")).toBe(true);
      expect(backdropExit()).toHaveLength(1);
      expect(Number.parseFloat(getComputedStyle(element, "::backdrop").animationDuration) * 1000).toBeCloseTo(
        dialogExitMs,
        3,
      );
      vi.advanceTimersByTime(dialogExitMs - 1);
      flush();
      expect(dialog()).toBe(element);
      vi.advanceTimersByTime(1);
      flush();
      expect(element.open).toBe(false);
      expect(element.isConnected).toBe(false);
      expect(container.querySelector("dialog")).toBeNull();
      expect(backdropExit()).toHaveLength(0);
      expect(document.activeElement).toBe(launcher);
    }
    expect(showModal).toHaveBeenCalledTimes(2);
  });

  it("cancels the exit on a rapid reopen without remounting or reopening the native dialog", () => {
    vi.useFakeTimers();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { setOpen } = mount(true);
    const element = dialog();
    setOpen(false);
    flush();
    vi.advanceTimersByTime(dialogExitMs / 2);
    setOpen(true);
    flush();
    vi.advanceTimersByTime(dialogExitMs);
    flush();
    expect(dialog()).toBe(element);
    expect(element.matches(":modal")).toBe(true);
    expect(container.querySelector(".modal-layer--closing")).toBeNull();
    expect(element.classList.contains("modal--closing")).toBe(false);
    expect(backdropExit()).toHaveLength(0);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it("closes immediately for reduced motion", () => {
    reducedMotion = true;
    const { setOpen } = mount(true);
    const element = dialog();
    setOpen(false);
    flush();
    expect(element.open).toBe(false);
    expect(container.querySelector("dialog")).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  it("handles a real Escape key via onCancel and restores launcher focus", async () => {
    const { onClose } = mount(true);
    const element = dialog();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => container.querySelector("dialog")).toBeNull();
    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  it("handles a real backdrop click through native light dismissal", async () => {
    const { onClose } = mount(true);
    const element = dialog();
    // Click a point outside the dialog box. Its ::backdrop hit-tests as the
    // dialog itself, and `closedby="any"` turns that into the cancel path.
    await userEvent.click(document.body, { position: { x: 2, y: 2 }, force: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    await expect.poll(() => container.querySelector("dialog")).toBeNull();
    expect(element.open).toBe(false);
    expect(document.activeElement).toBe(launcher);
  });

  it("closes an open dialog and clears the exit timer on disposal", () => {
    vi.useFakeTimers();
    const { setOpen } = mount(true);
    const element = dialog();
    setOpen(false);
    flush();
    dispose?.();
    dispose = undefined;
    expect(element.open).toBe(false);
    expect(element.isConnected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(dialogExitMs);
    flush();
    expect(container.querySelector("dialog")).toBeNull();
  });

  // Mounting into a detached container is a caller error: the unowned settle
  // fires once, so attaching the container afterwards never opens the dialog.
  it("does not try to open a branch whose render target is disconnected", () => {
    container.remove();
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    expect(() => mount(true)).not.toThrow();
    expect(showModal).not.toHaveBeenCalled();
    expect(dialog().open).toBe(false);
  });
});
