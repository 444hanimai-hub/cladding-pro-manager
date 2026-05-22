import React, { useState, useEffect, useRef } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { ExpenseCategory } from '../types';
import { cn } from '../lib/utils';

interface ExpenseCategorySelectProps {
  value: string;
  onChange: (value: string, id?: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function ExpenseCategorySelect({ value, onChange, placeholder, className, disabled }: ExpenseCategorySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState(value);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(collection(db, 'expense_categories'), orderBy('name'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseCategory)));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setSearchTerm(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredCategories = categories.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (category: ExpenseCategory) => {
    onChange(category.name, category.id);
    setSearchTerm(category.name);
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchTerm(val);
    onChange(val);
    setIsOpen(true);
  };

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <div className="relative group">
        <input 
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={() => !disabled && setIsOpen(true)}
          disabled={disabled}
          className={cn(
            "w-full border-none rounded-xl px-4 py-3 transition-all font-medium text-sm bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30",
            disabled && "opacity-60 cursor-not-allowed",
            disabled && "text-[#141414]/40"
          )} 
          placeholder={placeholder || "Начните вводить..."}
        />
      </div>

      {isOpen && filteredCategories.length > 0 && (
        <div className={cn(
          "absolute z-50 w-full mt-2 rounded-2xl shadow-2xl border overflow-hidden max-h-48 overflow-y-auto no-scrollbar",
          "bg-white border-[#141414]/10"
        )}>
          {filteredCategories.map(cat => (
            <button 
              key={cat.id}
              type="button"
              onClick={() => handleSelect(cat)}
              className={cn(
                "w-full text-left px-4 py-3 transition-colors text-sm font-medium hover:bg-[#141414]/5 text-[#141414]/80 hover:text-[#5A5A40]"
              )}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
