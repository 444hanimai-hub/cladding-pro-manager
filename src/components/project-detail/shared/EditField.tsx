import React from 'react';
import { DatePicker } from '../../ui/DatePicker';

function EditField({
                       label,
                       value,
                       isEditing,
                       onChange,
                       icon,
                       type = "text",
                       placeholder = "не указано"
                   }: {
    label: string,
    value: string,
    isEditing: boolean,
    onChange: (v: string) => void,
    icon: React.ReactNode,
    type?: string,
    placeholder?: string
}) {
    return (
        <div className="grid items-start gap-3.5 py-3.5" style={{ gridTemplateColumns: '32px 1fr' }}>
            <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink-3 shrink-0">
                <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
            </div>
            <div className="min-w-0">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">{label}</p>
                {isEditing ? (
                    type === 'date' ? (
                        <DatePicker value={value} onChange={onChange} className="w-full" variant="compact" />
                    ) : (
                        <input
                            type={type}
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            className="w-full bg-surface border border-line rounded-md px-3 py-2 text-[14px] text-ink focus:border-ochre focus:outline-none transition-colors"
                        />
                    )
                ) : (
                    value ? (
                        <p className="text-[14px] font-medium text-ink leading-snug">{value}</p>
                    ) : (
                        <p className="text-[14px] italic text-ink-4 leading-snug">{placeholder}</p>
                    )
                )}
            </div>
        </div>
    );
}


export default EditField;