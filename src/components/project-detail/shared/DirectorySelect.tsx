import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Plus, Truck, User as UserIcon, Package, Briefcase, Search } from 'lucide-react';
import { cn } from '../../../lib/utils';

function DirectorySelect({
                             value,
                             options,
                             onChange,
                             onAdd,
                             placeholder,
                             className,
                             iconType,
                             inputHeight = 'h-11'
                         }: {
    value: string,
    options: any[],
    onChange: (v: string) => void,
    onAdd?: (name: string) => Promise<void>,
    placeholder: string,
    className?: string,
    iconType?: 'carrier' | 'driver' | 'unit' | 'material',
    inputHeight?: string
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(value);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const dropdownRef = React.useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        setSearchTerm(value);
    }, [value]);

    useEffect(() => {
        const updateCoords = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setCoords({
                    top: rect.bottom + window.scrollY,
                    left: rect.left + window.scrollX,
                    width: rect.width
                });
            }
        };

        if (isOpen) {
            updateCoords();
            window.addEventListener('resize', updateCoords);
            window.addEventListener('scroll', updateCoords, true);
        }
        return () => {
            window.removeEventListener('resize', updateCoords);
            window.removeEventListener('scroll', updateCoords, true);
        };
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                containerRef.current && !containerRef.current.contains(target) &&
                (!dropdownRef.current || !dropdownRef.current.contains(target))
            ) {
                setIsOpen(false);
                setSearchTerm(value);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [value]);

    const filtered = options.filter(o =>
        (o.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const showCreate = onAdd && searchTerm.trim() !== '' &&
        !options.some(o => (o.name || '').toLowerCase() === searchTerm.toLowerCase().trim());

    const handleSelect = (name: string) => {
        onChange(name);
        setSearchTerm(name);
        setIsOpen(false);
    };

    const handleCreateNew = async () => {
        const name = searchTerm.trim();
        if (!name) return;
        setIsOpen(false);
        try {
            if (onAdd) {
                await onAdd(name);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        onChange(e.target.value);
        setIsOpen(true);
    };

    const getDropdownIcon = () => {
        switch (iconType) {
            case 'carrier':
                return <Truck size={13} />;
            case 'driver':
                return <UserIcon size={13} />;
            case 'material':
                return <Package size={13} />;
            default:
                return <Briefcase size={13} />;
        }
    };

    const hasLeftSearchIcon = iconType !== 'unit';

    return (
        <div className="relative w-full" ref={containerRef}>
            <div className="relative">
                {hasLeftSearchIcon && (
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                )}
                <input
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    className={cn(
                        "w-full bg-surface border border-line rounded-md text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 pr-9",
                        inputHeight,
                        hasLeftSearchIcon ? "pl-9" : "pl-3"
                    )}
                    placeholder={placeholder || "Начните вводить..."}
                />
                <ChevronDown size={14} className={cn("absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none transition-transform", isOpen && "rotate-180")} />
            </div>

            {isOpen && createPortal(
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'absolute',
                        top: `${coords.top}px`,
                        left: `${coords.left}px`,
                        width: `${coords.width}px`,
                        zIndex: 999999
                    }}
                >
                    <AnimatePresence>
                        <motion.div
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="w-full rounded-md bg-surface border border-line shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] overflow-hidden mt-1.5"
                        >
                            <div className="max-h-[240px] overflow-y-auto no-scrollbar">
                                {filtered.length > 0 ? (
                                    filtered.map(opt => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => handleSelect(opt.name)}
                                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                                        >
                                            {iconType !== 'unit' && (
                                                <span className="w-7 h-7 rounded-full bg-ochre-bg flex items-center justify-center text-ochre shrink-0">
                          {getDropdownIcon()}
                        </span>
                                            )}
                                            <span className="text-[13px] font-medium text-ink truncate">{opt.name}</span>
                                        </button>
                                    ))
                                ) : !showCreate ? (
                                    <p className="px-3 py-3 text-[12px] italic text-ink-4">Ничего не найдено</p>
                                ) : null}
                            </div>
                            {showCreate && onAdd && (
                                <button
                                    type="button"
                                    onClick={handleCreateNew}
                                    className="w-full flex items-center gap-2 px-3 py-2.5 text-[12.5px] font-semibold text-ochre border-t border-line bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
                                >
                                    <Plus size={13} />
                                    Создать «{searchTerm.trim()}»
                                </button>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>,
                document.body
            )}
        </div>
    );
}


export default DirectorySelect;