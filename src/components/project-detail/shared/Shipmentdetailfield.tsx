import React from 'react';
import { cn } from '../../../lib/utils';

export function ShipmentDetailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h5 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#B08B57] mb-2">
                {title}
            </h5>
            <div>{children}</div>
        </div>
    );
}

export function ShipmentDetailField({
                                        label,
                                        value,
                                        showDivider = true,
                                    }: {
    label: string;
    value?: React.ReactNode;
    showDivider?: boolean;
}) {
    return (
        <div className={cn('py-2', showDivider && 'border-b border-dashed border-[#E5E0D6]')}>
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#8A8574] mb-0.5 leading-tight">{label}</p>
            <div className="text-[12px] font-semibold text-[#2C2922] leading-tight">{value ?? '—'}</div>
        </div>
    );
}