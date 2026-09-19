import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { StakeholderGroup, Contact } from '../../../types';
import { User as UserIcon, Briefcase, Users, Edit3 } from 'lucide-react';

function StakeholderCard({ title, data, onEdit, canEdit }: { title: string, data?: StakeholderGroup, onEdit: () => void, canEdit: boolean }) {
    const [contacts, setContacts] = useState<Contact[]>([]);

    useEffect(() => {
        if (data?.contactIds?.length) {
            const q = query(collection(db, 'contacts'), where('__name__', 'in', data.contactIds));
            const unsubscribe = onSnapshot(q, (snapshot) => {
                setContacts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
            });
            return () => unsubscribe();
        } else {
            setContacts([]);
        }
    }, [data?.contactIds]);

    const iconNode = title === 'Заказчик' ? <UserIcon size={14} />
        : title === 'Генподрядчик' ? <Briefcase size={14} />
            : title === 'Подрядчик' ? <Users size={14} />
                : <Edit3 size={14} />;

    return (
        <div className="bg-surface border border-line rounded-2xl shadow-[0_1px_0_rgba(48,42,28,0.04),0_1px_2px_rgba(48,42,28,0.06)] overflow-hidden group">
            <div className="px-5 py-3.5 flex items-center justify-between gap-2 border-b border-line">
                <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-ochre-bg flex items-center justify-center text-ochre shrink-0">
                        {iconNode}
                    </div>
                    <h3 className="font-display text-[15px] font-medium text-ink leading-tight">{title}</h3>
                </div>
                {canEdit && (
                    <button
                        onClick={onEdit}
                        className="w-8 h-8 flex items-center justify-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
                    >
                        <Edit3 size={13} />
                    </button>
                )}
            </div>

            <div className="px-5 py-4 flex flex-col gap-3.5">
                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1">Компания</p>
                    {data?.companyName ? (
                        <p className="text-[13px] font-semibold text-ink">{data.companyName}</p>
                    ) : (
                        <p className="text-[12px] italic text-ink-4">не указана</p>
                    )}
                </div>

                <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 mb-1.5">Контактные лица</p>
                    {contacts.length > 0 ? (
                        <div className="flex flex-col gap-1.5">
                            {contacts.map(contact => (
                                <div key={contact.id} className="flex items-center gap-2.5 px-2.5 py-2 bg-surface-2 rounded-md">
                  <span className="w-6 h-6 rounded-full bg-surface flex items-center justify-center text-ink-3 shrink-0">
                    <UserIcon size={12} />
                  </span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12.5px] font-semibold text-ink truncate leading-tight">{contact.name}</p>
                                        <p className="text-[11px] text-ink-3 truncate mt-0.5">
                                            {contact.position}{contact.position && contact.phone && ' · '}{contact.phone && <span className="tabular-nums">{contact.phone}</span>}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-[11.5px] italic text-ink-4">не добавлены</p>
                    )}
                </div>
            </div>
        </div>
    );
}


export default StakeholderCard;