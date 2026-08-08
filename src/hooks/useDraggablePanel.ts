import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";

type Options = {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
  /** Panel footprint used to keep it on screen. */
  width?: number;
  height?: number;
};

/**
 * Pointer-drag + on-screen clamping for the floating glass panels
 * (manual steps, step tools). Shared so panels behave identically.
 */
export function useDraggablePanel({
  x,
  y,
  onChange,
  width = 280,
  height = 160,
}: Options) {
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);

  const clampTo = useCallback(
    (nx: number, ny: number) => ({
      x: Math.min(Math.max(8, nx), Math.max(8, window.innerWidth - width)),
      y: Math.min(Math.max(8, ny), Math.max(8, window.innerHeight - height)),
    }),
    [width, height],
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("a,button")) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { ox: event.clientX, oy: event.clientY, sx: x, sy: y };
      setDragging(true);
    },
    [x, y],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!dragRef.current) return;
      const dx = event.clientX - dragRef.current.ox;
      const dy = event.clientY - dragRef.current.oy;
      const next = clampTo(dragRef.current.sx + dx, dragRef.current.sy + dy);
      onChange(next.x, next.y);
    },
    [clampTo, onChange],
  );

  const endDrag = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const onResize = () => {
      const next = clampTo(x, y);
      if (next.x !== x || next.y !== y) onChange(next.x, next.y);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampTo, onChange, x, y]);

  return {
    dragging,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
