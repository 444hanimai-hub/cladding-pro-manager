import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Company } from '../types';
import { Search, ChevronDown, Plus, Briefcase } from 'lucide-react';
import { cn } from '../lib/utils';

interface CompanySelectProps {
  value: string;
  onChange: (value: string, id?: string) => void;
  placeholder?: string;
  className?: string;
  /** Если передан — показывает только компании с этим типом и при создании прописывает тип */
  companyType?: string;
  /** @deprecated используй companyType */
  onCreateCompany?: { companyType: string };
}

export default function CompanySelect({
                                        value,
                                        onChange,
                                        placeholder,
                                        className,
                                        companyType,
                                        onCreateCompany,
                                      }: CompanySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value);
  const [companies, setCompanies] = useState<(Company & { companyType?: string })[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

  const effectiveType = companyType || onCreateCompany?.companyType;

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'companies'), orderBy('name'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCompanies(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Company & { companyType?: string })));
    });
    return () => unsubscribe();
  }, []);

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
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Фильтруем: если тип задан — только точное совпадение (без типа не показываем)
  const filteredCompanies = companies
      .filter(c => !effectiveType || (c as any).companyType === effectiveType)
      .filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const showCreate = searchTerm.trim() !== '' &&
      !companies.some(c => c.name.toLowerCase() === searchTerm.toLowerCase().trim());

  const handleSelect = (company: Company & { companyType?: string }) => {
    onChange(company.name, company.id);
    setSearchTerm(company.name);
    setIsOpen(false);
  };

  const handleCreateNew = async () => {
    const name = searchTerm.trim();
    if (!name) return;
    setIsOpen(false);
    try {
      const docRef = await addDoc(collection(db, 'companies'), {
        name,
        ...(effectiveType ? { companyType: effectiveType } : {}),
        managerId: auth.currentUser?.uid,
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
              className="w-full bg-surface border border-line rounded-md pl-9 pr-9 text-[13px] text-ink focus:border-ochre focus:outline-none transition-colors placeholder:text-ink-4 h-9"
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
                {filteredCompanies.length > 0 ? (
                    filteredCompanies.map(company => (
                        <button
                            key={company.id}
                            type="button"
                            onClick={() => handleSelect(company)}
                            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 cursor-pointer"
                        >
                  <span className="w-7 h-7 rounded-full bg-ochre-bg flex items-center justify-center text-ochre shrink-0">
                    <Briefcase size={13} />
                  </span>
                          <span className="text-[13px] font-medium text-ink truncate">{company.name}</span>
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

