import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
  className?: string;
}

const Modal = ({ isOpen, onClose, title, description, children, footer, maxWidth = '520px', className }: ModalProps) => {
  return (
      <AnimatePresence>
        {isOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={onClose}
                  className="absolute inset-0 bg-ink/40"
                  style={{
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }}
              />
              <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                  className={cn(
                      'relative bg-surface border border-line rounded-xl shadow-lg w-full flex flex-col max-h-[90vh] overflow-hidden',
                      className
                  )}
                  style={{ maxWidth }}
              >
                <div className="px-5.5 py-4.5 border-b border-line bg-surface sticky top-0 z-10">
                  <div className="flex justify-between items-center mb-1">
                    <h2 className="font-display text-xl font-medium text-ink">{title}</h2>
                    <button
                        onClick={onClose}
                        className="text-ink-3 hover:text-ink transition-colors p-1"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {description && (
                      <p className="text-sm text-ink-3 tracking-wide">{description}</p>
                  )}
                </div>

                <div className="px-5.5 py-5 flex-1 overflow-auto">
                  {children}
                </div>

                {footer && (
                    <div className="px-5.5 py-3.5 border-t border-line flex justify-end gap-2.5 bg-surface-2/30 sticky bottom-0 z-10">
                      {footer}
                    </div>
                )}
              </motion.div>
            </div>
        )}
      </AnimatePresence>
  );
};

export { Modal };
