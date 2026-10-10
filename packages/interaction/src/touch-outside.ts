type TouchGesture = {
  down: PointerEvent;
  started: number;
  up?: PointerEvent;
  upTarget?: Element | null;
  touchStart?: TouchEvent;
  touchEnd?: TouchEvent;
  touchId?: number;
  click?: MouseEvent;
  listeners: Array<[string, EventListener]>;
  timers: ReturnType<typeof setTimeout>[];
};

/**
 * Tracks a touch until its native completion events have settled. A valid touch
 * can complete without a compatibility click (notably for blank Safari taps).
 */
export function makeTouchOutside(
  ownerDoc: Document,
  isOutside: (event: Event | { target: EventTarget | null }) => boolean,
  captureOutside?: () => (() => boolean) | undefined,
): { start: (down: PointerEvent, dispatch: () => boolean | void) => void; clear: () => void } {
  let pending: TouchGesture | undefined;

  const clear = () => {
    if (!pending) return;
    for (const [type, listener] of pending.listeners) {
      ownerDoc.removeEventListener(type, listener, true);
    }
    for (const timer of pending.timers) clearTimeout(timer);
    pending = undefined;
  };

  // Nearest ancestor of `a` that also contains `b`; document-level ancestors are not a control.
  const sharedElement = (a: Element, b: Element) => {
    let node: Element | null = a;
    while (node && !node.contains(b)) node = node.parentElement;
    return node === ownerDoc.body || node === ownerDoc.documentElement ? null : node;
  };

  const start = (down: PointerEvent, dispatch: () => boolean | void) => {
    if (pending) {
      const completed = !!pending.up;
      clear();
      if (!completed) return;
    }
    if (!down.isPrimary || !isOutside(down)) return;
    const isStillEligible = captureOutside?.() ?? (() => true);
    if (!isStillEligible()) return;

    const gesture: TouchGesture = {
      down,
      started: performance.now(),
      listeners: [],
      timers: [],
    };
    pending = gesture;

    const moved = (point: Pick<PointerEvent, "clientX" | "clientY">) =>
      Math.hypot(point.clientX - down.clientX, point.clientY - down.clientY) > 10;
    const listen = (type: string, listener: EventListener) => {
      gesture.listeners.push([type, listener]);
      ownerDoc.addEventListener(type, listener, { capture: true, passive: true });
    };
    const later = (callback: () => void, delay: number) => {
      gesture.timers.push(setTimeout(callback, delay));
    };
    const valid = () => {
      if (pending !== gesture || !gesture.up || (gesture.touchStart && !gesture.touchEnd))
        return false;
      if (
        [down, gesture.up, gesture.touchStart, gesture.touchEnd].some(
          event => event?.defaultPrevented,
        )
      ) {
        clear();
        return false;
      }
      const hit = ownerDoc.elementFromPoint?.(gesture.up.clientX, gesture.up.clientY);
      if (
        !isStillEligible() ||
        !isOutside(down) ||
        !gesture.upTarget ||
        !isOutside({ target: gesture.upTarget }) ||
        !hit ||
        !isOutside({ target: hit })
      ) {
        clear();
        return false;
      }
      return true;
    };
    const finish = (fallback: boolean) => {
      if (!valid()) return;
      const ElementConstructor = ownerDoc.defaultView?.Element;
      const original =
        ElementConstructor && down.target instanceof ElementConstructor
          ? (down.target.closest("button, a[href], input, select, textarea, label") ?? down.target)
          : down.target;
      const completionTarget = gesture.upTarget;
      clear();
      const accepted = dispatch();
      if (
        !fallback ||
        accepted === false ||
        !ElementConstructor ||
        !(original instanceof ElementConstructor) ||
        !completionTarget
      ) {
        return;
      }

      const remove = () => {
        clearTimeout(timer);
        ownerDoc.removeEventListener("click", swallow, true);
        ownerDoc.removeEventListener("pointerdown", remove, true);
      };
      const swallow = (event: Event) => {
        const click = event as MouseEvent;
        if (!click.detail || moved(click)) return;
        const hit = ownerDoc.elementFromPoint?.(click.clientX, click.clientY);
        if (!(event.target instanceof ElementConstructor) || !hit || !event.target.contains(hit)) {
          return;
        }
        if (!original.contains(hit) && !completionTarget.contains(hit)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        remove();
      };
      const timer = setTimeout(remove, 400);
      ownerDoc.addEventListener("click", swallow, true);
      ownerDoc.addEventListener("pointerdown", remove, true);
    };
    const complete = () => {
      later(() => {
        if (!valid()) return;
        if (gesture.click) finish(false);
        else later(() => finish(true), 400);
      }, 0);
    };

    listen("pointerdown", clear);
    listen("pointercancel", event => {
      if ((event as PointerEvent).pointerId === down.pointerId) clear();
    });
    listen("touchcancel", clear);
    listen("scroll", clear);
    listen("pointermove", event => {
      const move = event as PointerEvent;
      if (move.pointerId === down.pointerId && moved(move)) clear();
    });
    listen("touchstart", event => {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.changedTouches[0];
      if (
        gesture.touchStart ||
        touchEvent.touches.length !== 1 ||
        !touch ||
        touch.target !== down.target ||
        moved(touch)
      ) {
        clear();
        return;
      }
      gesture.touchStart = touchEvent;
      gesture.touchId = touch.identifier;
    });
    listen("touchmove", event => {
      const touchEvent = event as TouchEvent;
      const touch = [...touchEvent.touches].find(item => item.identifier === gesture.touchId);
      if (touchEvent.touches.length !== 1 || !touch || moved(touch)) clear();
    });
    listen("pointerup", event => {
      const up = event as PointerEvent;
      if (up.pointerId !== down.pointerId) return;
      if (moved(up) || performance.now() - gesture.started >= 500) {
        clear();
        return;
      }
      gesture.up = up;
      gesture.upTarget = ownerDoc.elementFromPoint?.(up.clientX, up.clientY);
      if (!gesture.touchStart) complete();
    });
    listen("touchend", event => {
      const touchEvent = event as TouchEvent;
      const touch = [...touchEvent.changedTouches].find(
        item => item.identifier === gesture.touchId,
      );
      if (!gesture.up || !touch || touchEvent.touches.length > 0 || moved(touch)) {
        clear();
        return;
      }
      gesture.touchEnd = touchEvent;
      complete();
    });
    listen("click", event => {
      const click = event as MouseEvent;
      if (!click.detail || moved(click) || !gesture.up) return;
      const target = click.target;
      const ElementConstructor = ownerDoc.defaultView?.Element;
      const original =
        ElementConstructor && down.target instanceof ElementConstructor
          ? (down.target.closest("button, a[href], input, select, textarea, label") ?? down.target)
          : null;
      const shared =
        ElementConstructor && down.target instanceof ElementConstructor && gesture.upTarget
          ? sharedElement(down.target, gesture.upTarget)
          : null;
      const matchesOriginalControl =
        ElementConstructor &&
        target instanceof ElementConstructor &&
        ((original && original.contains(target)) || (shared && shared.contains(target)));
      if (
        !matchesOriginalControl ||
        !isOutside({ target }) ||
        !gesture.upTarget ||
        (!target.contains(gesture.upTarget) && !gesture.upTarget.contains(target))
      ) {
        return;
      }
      gesture.click = click;
      later(() => finish(false), 0);
    });
    later(() => {
      if (!gesture.up || (gesture.touchStart && !gesture.touchEnd)) clear();
    }, 500);
  };

  return { start: start, clear: clear };
}
