import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface PortalDropdownProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function PortalDropdown({ anchorRef, open, onClose, children }: PortalDropdownProps) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const updatePosition = () => {
      if (!anchorRef.current) return;
      const r = anchorRef.current.getBoundingClientRect();
      setPos({
        top: r.bottom + 4,
        left: r.left,
        width: r.width
      });
    };

    updatePosition();

    // Закрываем меню при любом скролле и ресайзе — позиция всё равно станет неверной
    const closeOnScroll = () => onClose();
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);

    return () => {
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [open, anchorRef, onClose]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;  // клик в триггер — игнор
      if (menuRef.current?.contains(t)) return;    // клик в меню — игнор
      onClose();                                    // всё остальное — закрываем
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1000 }}
      className="bg-surface border border-line rounded-md shadow-[0_12px_28px_-12px_rgba(48,42,28,0.22)] py-1 max-h-[260px] overflow-y-auto"
    >
      {children}
    </div>,
    document.body
  );
}
