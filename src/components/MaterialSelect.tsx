import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Search, Plus, ChevronDown, Package } from 'lucide-react';
import { cn } from '../lib/utils';

interface MaterialSelectProps {
    value: string;
    /** ID выбранного материала (если есть) — по нему восстанавливаем полную склейку
     * в самом поле (не только в выпадающем списке), в том числе при повторном
     * открытии формы редактирования, когда справочник материалов уже загружен. */
    materialId?: string;
    onChange: (value: string, id?: string) => void;
    placeholder?: string;
    className?: string;
}

interface MaterialOption {
    id: string;
    name: string;
    characteristics?: string;
    manufacturerId?: string;
}

/** Склейка "Наименование, Характеристики, Производитель" для отображения в списке —
 * сама сохраняемая ссылка (value) остаётся коротким названием материала, склейка
 * нужна только для того, чтобы было проще найти нужный материал среди похожих.
 * Название производителя сюда приходит УЖЕ разрешённым по ID из живого справочника
 * компаний (см. вызов ниже) — в самом материале хранится только manufacturerId. */
function formatMaterialLabel(m: MaterialOption, manufacturerName?: string): string {
    return [m.name, m.characteristics, manufacturerName].filter(Boolean).join(', ');
}

export default function MaterialSelect({ value, materialId, onChange, placeholder, className }: MaterialSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState(value);
    const [materials, setMaterials] = useState<MaterialOption[]>([]);
    // Живой справочник компаний, только для разрешения manufacturerId → название —
    // тот же принцип, что и для вида товара: не хранить копию строки, а смотреть
    // актуальное название прямо в момент отображения.
    const [companyNames, setCompanyNames] = useState<Record<string, string>>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

    useEffect(() => {
        const q = query(collection(db, 'materials'), orderBy('name'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setMaterials(snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    name: data.name || '',
                    characteristics: data.characteristics || '',
                    manufacturerId: data.manufacturerId || '',
                };
            }));
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        const unsubscribe = onSnapshot(collection(db, 'companies'), (snapshot) => {
            const map: Record<string, string> = {};
            snapshot.docs.forEach(doc => { map[doc.id] = (doc.data() as any).name || ''; });
            setCompanyNames(map);
        });
        return () => unsubscribe();
    }, []);

    // Пока список открыт (человек ищет/печатает) — показываем то, что он реально
    // набирает, ничего не подменяя. Как только список закрыт — если materialId
    // указывает на известный материал, показываем полную склейку по нему, а не
    // просто короткое сохранённое имя (value).
    useEffect(() => {
        if (isOpen) return;
        const matched = materialId ? materials.find(mat => mat.id === materialId) : undefined;
        setSearchTerm(matched ? formatMaterialLabel(matched, companyNames[matched.manufacturerId || '']) : value);
    }, [value, materialId, materials, companyNames, isOpen]);

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
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Поиск идёт и по названию, и по всей склейке — так находится, даже если ввести
    // часть характеристик или производителя, а не только короткое название.
    const filteredMaterials = materials.filter(m =>
        formatMaterialLabel(m, companyNames[m.manufacturerId || '']).toLowerCase().includes(searchTerm.toLowerCase())
    );

    const showCreate = searchTerm.trim() !== '' &&
        !materials.some(m => m.name.toLowerCase() === searchTerm.toLowerCase().trim());

    const handleSelect = (item: MaterialOption) => {
        // Сохраняется (onChange) короткое название — как и раньше, для совместимости
        // с остальной системой (таблицы, доверенности и т.п.). А вот в самом поле
        // показываем полную склейку — так сразу видно, что выбран нужный материал.
        onChange(item.name, item.id);
        setSearchTerm(formatMaterialLabel(item, companyNames[item.manufacturerId || '']));
        setIsOpen(false);
    };

    const handleCreateNew = async () => {
        const name = searchTerm.trim();
        if (!name) return;
        setIsOpen(false);
        try {
            const docRef = await addDoc(collection(db, 'materials'), {
                name,
                createdAt: serverTimestamp()
            });
            onChange(name, docRef.id);
        } catch (error) {
            console.error(error);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchTerm(e.target.value);
        onChange(e.target.value);
        setIsOpen(true);
    };

    return (
        <div className={cn("relative w-full", className)} ref={containerRef}>
            <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
                <input
                    value={searchTerm}
                    onChange={handleInputChange}
                    onFocus={() => setIsOpen(true)}
                    className="w-full bg-surface border border-line rounded-md pl-9 pr-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 h-11"
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
                    className="rounded-md bg-surface border border-line shadow-[0_24px_48px_-12px_rgba(48,42,28,0.28)] overflow-hidden mt-1.5"
                >
                    <div className="max-h-[240px] overflow-y-auto">
                        {filteredMaterials.length > 0 ? (
                            filteredMaterials.map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleSelect(item)}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                                >
                  <span className="w-7 h-7 rounded-full bg-ochre-bg flex items-center justify-center text-ochre shrink-0 font-medium">
                    <Package size={13} />
                  </span>
                                    <span className="text-[13px] font-medium text-ink truncate">{formatMaterialLabel(item, companyNames[item.manufacturerId || ''])}</span>
                                </button>
                            ))
                        ) : !showCreate ? (
                            <p className="px-3 py-3 text-[12px] italic text-ink-4">Ничего не найдено</p>
                        ) : null}
                    </div>
                    {showCreate && (
                        <button
                            type="button"
                            onClick={handleCreateNew}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-[12.5px] font-semibold text-ochre border-t border-line bg-surface hover:bg-surface-2 transition-colors cursor-pointer"
                        >
                            <Plus size={13} />
                            Создать «{searchTerm.trim()}»
                        </button>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
}