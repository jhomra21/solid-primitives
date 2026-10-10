import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, onTestFinished } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";
import { createInteractOutside, type CreateInteractOutsideProps } from "../src/index.js";

beforeAll(() => {
  if (!("PointerEvent" in window)) {
    class MockPointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    (global as unknown as Record<string, unknown>)["PointerEvent"] = MockPointerEvent;
  }
});

type ElementKind = "div" | "svg";

function createElement(kind: ElementKind, testId: string): Element {
  if (kind === "svg") {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("data-testid", testId);
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "img");
    return el;
  }
  const el = document.createElement("div");
  el.setAttribute("data-testid", testId);
  el.tabIndex = 0;
  return el;
}

function setupTest(
  insideKind: ElementKind,
  outsideKind: ElementKind,
  extraProps: Partial<CreateInteractOutsideProps> = {},
) {
  const onFocusOutside = vi.fn();
  const onPointerDownOutside = vi.fn();
  const onInteractOutside = vi.fn();

  const container = document.createElement("div");
  const inside = createElement(insideKind, "inside");
  const outside = createElement(outsideKind, "outside");
  container.appendChild(inside);
  container.appendChild(outside);
  document.body.appendChild(container);

  const dispose = createRoot(d => {
    createInteractOutside(
      { onFocusOutside, onPointerDownOutside, onInteractOutside, ...extraProps },
      () => inside,
    );
    return d;
  });

  flush();
  vi.runAllTimers(); // advance setTimeout for pointerdown listener registration

  return {
    mocks: { onFocusOutside, onPointerDownOutside, onInteractOutside },
    inside,
    outside,
    cleanup: () => {
      dispose();
      document.body.removeChild(container);
    },
  };
}

const testConfigurations: { name: string; inside: ElementKind; outside: ElementKind }[] = [
  { name: "HTML ref with HTML outside", inside: "div", outside: "div" },
  { name: "SVG ref with HTML outside", inside: "svg", outside: "div" },
  { name: "HTML ref with SVG outside", inside: "div", outside: "svg" },
  { name: "SVG ref with SVG outside", inside: "svg", outside: "svg" },
];

describe("createInteractOutside", () => {
  let elementFromPointDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  });

  afterEach(() => {
    if (elementFromPointDescriptor) {
      Object.defineProperty(document, "elementFromPoint", elementFromPointDescriptor);
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    vi.useRealTimers();
  });

  describe.each(testConfigurations)("$name", ({ inside: insideKind, outside: outsideKind }) => {
    describe("Focus Events", () => {
      it("triggers onFocusOutside and onInteractOutside when focusing outside", () => {
        const { mocks, outside, cleanup } = setupTest(insideKind, outsideKind);
        outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(mocks.onFocusOutside).toHaveBeenCalledTimes(1);
        expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
        expect(mocks.onInteractOutside).toHaveBeenCalledTimes(1);
        cleanup();
      });

      it("does not trigger when focusing inside", () => {
        const { mocks, inside, cleanup } = setupTest(insideKind, outsideKind);
        inside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(mocks.onFocusOutside).not.toHaveBeenCalled();
        expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
        expect(mocks.onInteractOutside).not.toHaveBeenCalled();
        cleanup();
      });

      it("passes the original FocusEvent in event detail", () => {
        const { mocks, outside, cleanup } = setupTest(insideKind, outsideKind);
        const focusEvent = new FocusEvent("focusin", { bubbles: true });
        outside.dispatchEvent(focusEvent);
        const receivedEvent = mocks.onFocusOutside.mock.calls[0]![0];
        expect(receivedEvent.detail.originalEvent).toBe(focusEvent);
        expect(receivedEvent.detail.isContextMenu).toBe(false);
        cleanup();
      });

      it("stops calling onInteractOutside when onFocusOutside calls preventDefault", () => {
        const { mocks, outside, cleanup } = setupTest(insideKind, outsideKind, {
          onFocusOutside: e => e.preventDefault(),
        });
        outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        expect(mocks.onInteractOutside).not.toHaveBeenCalled();
        cleanup();
      });
    });

    describe("Pointer Events", () => {
      it("triggers onPointerDownOutside and onInteractOutside when clicking outside", () => {
        const { mocks, outside, cleanup } = setupTest(insideKind, outsideKind);
        outside.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
        );
        expect(mocks.onFocusOutside).not.toHaveBeenCalled();
        expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
        expect(mocks.onInteractOutside).toHaveBeenCalledTimes(1);
        cleanup();
      });

      it("does not trigger when clicking inside", () => {
        const { mocks, inside, cleanup } = setupTest(insideKind, outsideKind);
        inside.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
        );
        expect(mocks.onFocusOutside).not.toHaveBeenCalled();
        expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
        expect(mocks.onInteractOutside).not.toHaveBeenCalled();
        cleanup();
      });

      it("passes the original PointerEvent in event detail", () => {
        const { mocks, outside, cleanup } = setupTest(insideKind, outsideKind);
        const pointerEvent = new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "mouse",
        });
        outside.dispatchEvent(pointerEvent);
        const receivedEvent = mocks.onPointerDownOutside.mock.calls[0]![0];
        expect(receivedEvent.detail.originalEvent).toBe(pointerEvent);
        cleanup();
      });

      it("stops calling onInteractOutside when onPointerDownOutside calls preventDefault", () => {
        const { mocks, outside, cleanup } = setupTest(insideKind, outsideKind, {
          onPointerDownOutside: e => e.preventDefault(),
        });
        outside.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
        );
        expect(mocks.onInteractOutside).not.toHaveBeenCalled();
        cleanup();
      });
    });
  });

  describe("Touch completion", () => {
    it("dispatches after a completed outside touch without waiting for a compatibility click", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      const elementFromPoint = vi.fn(() => outside as HTMLElement);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: elementFromPoint,
      });
      const pointerDown = new PointerEvent("pointerdown", {
        bubbles: true,
        pointerType: "touch",
        pointerId: 7,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      });
      outside.dispatchEvent(pointerDown);
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerType: "touch",
          pointerId: 7,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        }),
      );

      vi.advanceTimersByTime(401);

      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      expect(mocks.onPointerDownOutside.mock.calls[0]![0].detail.originalEvent).toBe(pointerDown);
      elementFromPoint.mockRestore();
      cleanup();
    });

    it("does not treat an unrelated click as the touch compatibility click", () => {
      const { mocks, inside, outside, cleanup } = setupTest("div", "div");
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      outside.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
          pointerId: 8,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerType: "touch",
          pointerId: 8,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        }),
      );

      inside.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
      vi.advanceTimersByTime(1);
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();

      vi.advanceTimersByTime(400);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("cancels a completed touch when its matching compatibility click is prevented", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      onTestFinished(cleanup);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      outside.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
          pointerId: 9,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        }),
      );
      document.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerType: "touch",
          pointerId: 9,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        }),
      );
      outside.addEventListener("click", event => event.preventDefault(), { once: true });

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 12,
        clientY: 18,
      });
      outside.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      vi.advanceTimersByTime(1);

      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
    });

    it("cancels a completed touch when a native control's matching click is prevented after dispatch", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      onTestFinished(cleanup);
      const button = document.createElement("button");
      outside.append(button);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => button,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 28,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      button.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      vi.advanceTimersByTime(1); // completion runs and schedules the no-click fallback
      button.addEventListener("click", event => event.preventDefault());
      button.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 12,
          clientY: 18,
        }),
      );
      vi.advanceTimersByTime(401);

      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
    });

    it("cancels a completed touch when a custom control's matching click is prevented after dispatch", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      onTestFinished(cleanup);
      const control = document.createElement("div");
      control.setAttribute("role", "button");
      const first = document.createElement("span");
      const second = document.createElement("span");
      control.append(first, second);
      outside.append(control);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => second,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 29,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      first.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      vi.advanceTimersByTime(1);
      control.addEventListener("click", event => event.preventDefault());
      control.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 12,
          clientY: 18,
        }),
      );
      vi.advanceTimersByTime(401);

      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
    });

    it("does not let an unrelated prevented click cancel a completed touch", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      onTestFinished(cleanup);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 30,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      outside.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      const unrelated = document.createElement("button");
      document.body.append(unrelated);
      onTestFinished(() => unrelated.remove());
      unrelated.addEventListener("click", event => event.preventDefault());
      unrelated.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 12,
          clientY: 18,
        }),
      );
      vi.advanceTimersByTime(1);
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();

      vi.advanceTimersByTime(400);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(400); // flush the late-click guard timer so it cannot leak into later tests
    });

    it("uses a matching compatibility click without waiting for the fallback", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 20,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      outside.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      outside.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 12,
          clientY: 18,
        }),
      );

      vi.advanceTimersByTime(1);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("waits for the matching touchend after pointerup", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      const point = { identifier: 21, target: outside, clientX: 12, clientY: 18 };
      const touchEvent = (
        type: string,
        touches: (typeof point)[],
        changedTouches: (typeof point)[],
      ) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: touches },
          changedTouches: { value: changedTouches },
        });
        document.dispatchEvent(event);
        return event;
      };
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 21,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      outside.dispatchEvent(new PointerEvent("pointerdown", init));
      touchEvent("touchstart", [point], [point]);
      document.dispatchEvent(new PointerEvent("pointerup", init));
      vi.advanceTimersByTime(401);
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();

      touchEvent("touchend", [], [point]);
      vi.advanceTimersByTime(401);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("tracks touches in the referenced element's adopted owner document", () => {
      const frame = document.createElement("iframe");
      document.body.appendChild(frame);
      const ownerDoc = frame.contentDocument!;
      const inside = ownerDoc.createElement("div");
      const outside = ownerDoc.createElement("button");
      ownerDoc.body.append(inside, outside);
      const onPointerDownOutside = vi.fn();
      Object.defineProperty(ownerDoc, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });

      const dispose = createRoot(d => {
        createInteractOutside({ onPointerDownOutside }, () => inside);
        return d;
      });
      flush();
      vi.runAllTimers();
      const pointerDown = new PointerEvent("pointerdown", {
        bubbles: true,
        pointerType: "touch",
        pointerId: 10,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      });
      Object.defineProperty(pointerDown, "isPrimary", { value: true });
      outside.dispatchEvent(pointerDown);
      const pointerUp = new PointerEvent("pointerup", {
        bubbles: true,
        pointerType: "touch",
        pointerId: 10,
        clientX: 12,
        clientY: 18,
      });
      Object.defineProperty(pointerUp, "isPrimary", { value: true });
      ownerDoc.dispatchEvent(pointerUp);
      vi.advanceTimersByTime(401);

      expect(onPointerDownOutside).toHaveBeenCalledTimes(1);
      expect(onPointerDownOutside.mock.calls[0]![0].detail.originalEvent).toBe(pointerDown);
      dispose();
      frame.remove();
    });

    it.each(["pointercancel", "movement", "held", "prevented pointerup"] as const)(
      "rejects a %s touch",
      failure => {
        const { mocks, outside, cleanup } = setupTest("div", "div");
        Object.defineProperty(document, "elementFromPoint", {
          configurable: true,
          value: () => outside,
        });
        const init = {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
          pointerId: 11,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        };
        outside.dispatchEvent(new PointerEvent("pointerdown", init));
        if (failure === "pointercancel") {
          document.dispatchEvent(new PointerEvent("pointercancel", init));
        } else if (failure === "movement") {
          document.dispatchEvent(new PointerEvent("pointermove", { ...init, clientX: 24 }));
        } else if (failure === "held") {
          vi.advanceTimersByTime(500);
        } else {
          document.addEventListener("pointerup", event => event.preventDefault(), { once: true });
        }

        if (failure !== "held" && failure !== "pointercancel") {
          document.dispatchEvent(new PointerEvent("pointerup", init));
        }
        vi.advanceTimersByTime(401);

        expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
        cleanup();
      },
    );

    it("rejects a multi-touch start", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      const point = (identifier: number) => ({
        identifier,
        target: outside,
        clientX: 12,
        clientY: 18,
      });
      const event = new Event("touchstart", { bubbles: true });
      Object.defineProperties(event, {
        touches: { value: [point(22), point(23)] },
        changedTouches: { value: [point(22), point(23)] },
      });
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      outside.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
          pointerId: 22,
          isPrimary: true,
          clientX: 12,
          clientY: 18,
        }),
      );
      document.dispatchEvent(event);
      vi.advanceTimersByTime(401);
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
      cleanup();
    });

    it("ignores unrelated pointer identities and dispatches once for the matching pointer", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      outside.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 12 }));
      document.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerId: 99 }));
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
      document.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerId: 12 }));
      vi.advanceTimersByTime(401);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("ignores an unrelated pointercancel and still dispatches for the active pointer", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      outside.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 7 }));
      document.dispatchEvent(new PointerEvent("pointercancel", { ...init, pointerId: 99 }));
      document.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerId: 7 }));
      vi.advanceTimersByTime(401);

      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("accepts a compatibility click on the original control when hit testing resolves its child", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      const button = document.createElement("button");
      const child = document.createElement("span");
      button.append(child);
      outside.append(button);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => child,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 24,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      button.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      button.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 12,
          clientY: 18,
        }),
      );
      vi.advanceTimersByTime(1);

      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("accepts a compatibility click on a custom button when the touch moves between its children", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      const control = document.createElement("div");
      control.setAttribute("role", "button");
      const first = document.createElement("span");
      const second = document.createElement("span");
      control.append(first, second);
      outside.append(control);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => second,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 26,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      first.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      control.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
          clientX: 12,
          clientY: 18,
        }),
      );
      vi.advanceTimersByTime(1);

      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("does not accept a click on an unrelated control or ancestor as the compatibility click", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      const first = document.createElement("span");
      const second = document.createElement("span");
      outside.append(first, second);
      const unrelated = document.createElement("button");
      document.body.append(unrelated);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => second,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 27,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      first.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      const clickInit = { bubbles: true, cancelable: true, detail: 1, clientX: 12, clientY: 18 };
      unrelated.dispatchEvent(new MouseEvent("click", clickInit));
      document.body.dispatchEvent(new MouseEvent("click", clickInit));
      vi.advanceTimersByTime(1);

      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
      vi.advanceTimersByTime(400);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();
      unrelated.remove();
    });

    it("rejects a completed touch after a transient layer-stack generation change", () => {
      let layerGeneration = 0;
      const { mocks, outside, cleanup } = setupTest("div", "div", {
        captureTouchOutside: () => {
          const generationAtPointerDown = layerGeneration;
          return () => generationAtPointerDown === layerGeneration;
        },
      });
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 13,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      outside.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      layerGeneration += 2; // A layer opens and closes, leaving the stack depth unchanged.
      vi.advanceTimersByTime(401);

      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
      cleanup();
    });

    it("preserves the original control's activation while guarding a later exposed target", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      const original = document.createElement("button");
      const child = document.createElement("span");
      const exposed = document.createElement("button");
      outside.append(original);
      original.append(child);
      document.body.append(exposed);
      const originalActivation = vi.fn();
      const exposedActivation = vi.fn();
      child.addEventListener("click", originalActivation);
      exposed.addEventListener("click", exposedActivation);
      let hit: Element = outside;
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => hit,
      });
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 14,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      original.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      vi.advanceTimersByTime(401);

      hit = child;
      const originalClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 12,
        clientY: 18,
      });
      child.dispatchEvent(originalClick);
      expect(originalClick.defaultPrevented).toBe(false);
      expect(originalActivation).toHaveBeenCalledTimes(1);
      expect(mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      cleanup();

      const next = setupTest("div", "div");
      hit = next.outside;
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => hit,
      });
      next.outside.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 16 }));
      document.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerId: 16 }));
      vi.advanceTimersByTime(401);
      hit = exposed;
      const exposedClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 12,
        clientY: 18,
      });
      exposed.dispatchEvent(exposedClick);
      expect(exposedClick.defaultPrevented).toBe(true);
      expect(exposedActivation).not.toHaveBeenCalled();
      expect(next.mocks.onPointerDownOutside).toHaveBeenCalledTimes(1);
      next.cleanup();
      exposed.remove();
    });

    it("does not install the late-click guard when the outside event is canceled", () => {
      const onPointerDownOutside = vi.fn((event: Event) => event.preventDefault());
      const { outside, cleanup } = setupTest("div", "div", { onPointerDownOutside });
      const exposed = document.createElement("button");
      document.body.append(exposed);
      const init = {
        bubbles: true,
        pointerType: "touch",
        pointerId: 15,
        isPrimary: true,
        clientX: 12,
        clientY: 18,
      };
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => outside,
      });
      outside.dispatchEvent(new PointerEvent("pointerdown", init));
      document.dispatchEvent(new PointerEvent("pointerup", init));
      vi.advanceTimersByTime(401);
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => exposed,
      });

      const click = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        detail: 1,
        clientX: 12,
        clientY: 18,
      });
      exposed.dispatchEvent(click);

      expect(onPointerDownOutside).toHaveBeenCalledTimes(1);
      expect(click.defaultPrevented).toBe(false);
      cleanup();
      exposed.remove();
    });
  });

  describe("Configuration", () => {
    it("does not trigger when disabled is true", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div", { disabled: true });
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(mocks.onFocusOutside).not.toHaveBeenCalled();
      expect(mocks.onPointerDownOutside).not.toHaveBeenCalled();
      expect(mocks.onInteractOutside).not.toHaveBeenCalled();
      cleanup();
    });

    it("does not trigger when disabled accessor returns true", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div", { disabled: () => true });
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(mocks.onFocusOutside).not.toHaveBeenCalled();
      cleanup();
    });

    it("does not trigger when shouldExcludeElement returns true for the target", () => {
      let excluded: Element | null = null;
      const { mocks, outside, cleanup } = setupTest("div", "div", {
        shouldExcludeElement: el => el === excluded,
      });
      excluded = outside;
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(mocks.onInteractOutside).not.toHaveBeenCalled();
      cleanup();
    });

    it("triggers when shouldExcludeElement returns false", () => {
      const shouldExcludeElement = vi.fn(() => false);
      const { mocks, outside, cleanup } = setupTest("div", "div", { shouldExcludeElement });
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(shouldExcludeElement).toHaveBeenCalledWith(outside);
      expect(mocks.onInteractOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("re-enables listeners when disabled changes from true to false", () => {
      // Must use a Solid signal so the effect reacts to the change.
      const [disabled, setIsDisabled] = createSignal(true);
      const { mocks, outside, cleanup } = setupTest("div", "div", { disabled });

      // Disabled — should not trigger
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(mocks.onFocusOutside).not.toHaveBeenCalled();

      // Enable and flush to re-register listeners
      setIsDisabled(false);
      flush();
      vi.runAllTimers();

      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(mocks.onFocusOutside).toHaveBeenCalledTimes(1);
      cleanup();
    });

    it("registers listeners when ref resolves from undefined to an element", () => {
      const onFocusOutside = vi.fn();
      const [ref, setRef] = createSignal<HTMLDivElement | undefined>(undefined);

      const container = document.createElement("div");
      const outside = document.createElement("div");
      container.appendChild(outside);
      document.body.appendChild(container);

      const dispose = createRoot(d => {
        createInteractOutside({ onFocusOutside }, ref);
        return d;
      });

      flush();
      vi.runAllTimers();

      // ref is still undefined — no listeners registered
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(onFocusOutside).not.toHaveBeenCalled();

      // ref resolves — effect re-runs and registers listeners
      const inside = document.createElement("div");
      container.insertBefore(inside, outside);
      setRef(inside as HTMLDivElement);
      flush();
      vi.runAllTimers();

      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(onFocusOutside).toHaveBeenCalledTimes(1);

      dispose();
      document.body.removeChild(container);
    });

    it("cleans up listeners when reactive root is disposed", () => {
      const { mocks, outside, cleanup } = setupTest("div", "div");
      cleanup();
      outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      expect(mocks.onFocusOutside).not.toHaveBeenCalled();
    });

    it("does not fire for a still-mounted instance whose watched element was removed from the document before its reactive root disposed", () => {
      // Reproduces a real-world race: a dismissable layer's DOM subtree is
      // removed synchronously (e.g. by a Solid `<Show>`) when it closes, but
      // the reactive owner that will call `onCleanup` (removing this
      // instance's document-level listeners) can be scheduled to run a tick
      // later. A second layer opening in that window must not have its
      // legitimate "inside" interactions misread as "outside" by the first,
      // now-orphaned instance.
      const first = setupTest("div", "div");

      // Simulate the DOM removal that happens immediately on close, while
      // deliberately *not* calling `first.cleanup()` yet — this is the gap
      // between DOM removal and reactive disposal that the real bug lives in.
      first.inside.remove();

      const second = setupTest("div", "div");

      // An interaction with the second (live) instance's own content.
      second.inside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

      // The second instance's own element is "inside" itself, so it must not
      // fire. The first (orphaned) instance's callbacks must not fire either
      // — its watched element is disconnected, so it has nothing left to
      // protect.
      expect(second.mocks.onFocusOutside).not.toHaveBeenCalled();
      expect(first.mocks.onFocusOutside).not.toHaveBeenCalled();

      first.cleanup();
      second.cleanup();
    });
  });
});
