import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, addDoc, updateDoc, doc, deleteDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { Company, Contact, ExpenseCategory, AppUser, DirectoryItem, Material, Carrier } from '../types';
import { 
  Building, 
  User, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X,
  Users,
  Layers,
  Maximize,
  Truck,
  Wallet,
  LayoutGrid,
  ChevronRight,
  MoreHorizontal,
  Search,
  Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { OperationType, handleFirestoreError } from '../lib/firestore-errors';

export default function DirectoryManager({ appUser }: { appUser: AppUser | null }) {
  const [activeTab, setActiveTab] = useState<'companies' | 'contacts' | 'expense_categories' | 'materials' | 'units' | 'drivers' | 'carriers'>('companies');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([]);
  const [materials, setMaterials] = useState<DirectoryItem[]>([]);
  const [units, setUnits] = useState<DirectoryItem[]>([]);
  const [drivers, setDrivers] = useState<DirectoryItem[]>([]);
  const [carriers, setCarriers] = useState<DirectoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newExpCategoryName, setNewExpCategoryName] = useState('');
  const [newDirectoryItemName, setNewDirectoryItemName] = useState('');
  const [newMaterialDetails, setNewMaterialDetails] = useState({ brand: '', country: '', article: '' });
  const [newCarrierDetails, setNewCarrierDetails] = useState({ contactPerson: '', phone: '', email: '' });
  const [newContact, setNewContact] = useState({ name: '', position: '', phone: '', companyId: '' });

  useEffect(() => {
    const unsubCompanies = onSnapshot(query(collection(db, 'companies'), orderBy('name')), (snap) => {
      setCompanies(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Company)));
    });
    const unsubContacts = onSnapshot(query(collection(db, 'contacts'), orderBy('name')), (snap) => {
      setContacts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Contact)));
    });
    const unsubExp = onSnapshot(query(collection(db, 'expense_categories'), orderBy('name')), (snap) => {
      setExpenseCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseCategory)));
    });
    const unsubMaterials = onSnapshot(query(collection(db, 'materials'), orderBy('name')), (snap) => {
      setMaterials(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DirectoryItem)));
    });
    const unsubUnits = onSnapshot(query(collection(db, 'units'), orderBy('name')), (snap) => {
      setUnits(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DirectoryItem)));
    });
    const unsubDrivers = onSnapshot(query(collection(db, 'drivers'), orderBy('name')), (snap) => {
      setDrivers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DirectoryItem)));
    });
    const unsubCarriers = onSnapshot(query(collection(db, 'carriers'), orderBy('name')), (snap) => {
      setCarriers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as DirectoryItem)));
      setLoading(false);
    });
    return () => { 
      unsubCompanies(); unsubContacts(); unsubExp(); 
      unsubMaterials(); unsubUnits(); unsubDrivers(); unsubCarriers();
    };
  }, []);

  const filteredCompanies = companies.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredContacts = contacts.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredExp = expenseCategories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredMaterials = materials.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredUnits = units.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredDrivers = drivers.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const filteredCarriers = carriers.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-1 lg:grid-cols-12 gap-8"
    >
      {/* Sidebar Categories */}
      <div className="lg:col-span-3 space-y-4">
        <div className={cn(
          "p-6 rounded-[32px] border transition-colors",
          "bg-white border-[#141414]/5 shadow-xl shadow-[#141414]/5"
        )}>
          <h3 className={cn("text-[10px] font-bold uppercase tracking-[0.2em] mb-6 px-4 opacity-40", "text-[#141414]")}>
            Справочники
          </h3>
          <nav className="space-y-1">
            <CategoryButton 
              active={activeTab === 'companies'} 
              onClick={() => setActiveTab('companies')} 
              label="Компании" 
              count={companies.length} 
              icon={<Briefcase size={16} />}
            />
            <CategoryButton 
              active={activeTab === 'contacts'} 
              onClick={() => setActiveTab('contacts')} 
              label="Контакты" 
              count={contacts.length} 
              icon={<Users size={16} />}
            />
            <CategoryButton 
              active={activeTab === 'materials'} 
              onClick={() => setActiveTab('materials')} 
              label="Материалы" 
              count={materials.length} 
              icon={<Layers size={16} />}
            />
            <CategoryButton 
              active={activeTab === 'units'} 
              onClick={() => setActiveTab('units')} 
              label="Ед. измерения" 
              count={units.length} 
              icon={<Maximize size={16} />}
            />
            <CategoryButton 
              active={activeTab === 'drivers'} 
              onClick={() => setActiveTab('drivers')} 
              label="Водители" 
              count={drivers.length} 
              icon={<User size={16} />}
            />
            <CategoryButton 
              active={activeTab === 'carriers'} 
              onClick={() => setActiveTab('carriers')} 
              label="Перевозчики" 
              count={carriers.length} 
              icon={<Truck size={16} />}
            />
            <CategoryButton 
              active={activeTab === 'expense_categories'} 
              onClick={() => setActiveTab('expense_categories')} 
              label="Виды расходов" 
              count={expenseCategories.length} 
              icon={<Wallet size={16} />}
            />
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <div className="lg:col-span-9 space-y-4">
        <div className={cn(
          "rounded-[32px] border transition-colors overflow-hidden flex flex-col min-h-[600px]",
          "bg-white border-[#141414]/5 shadow-xl shadow-[#141414]/5"
        )}>
          {/* Content Header */}
          <div className="p-8 pb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h2 className={cn("text-2xl font-serif font-medium", "text-[#141414]")}>
                {activeTab === 'companies' ? 'Компании' : 
                 activeTab === 'contacts' ? 'Контакты' : 
                 activeTab === 'expense_categories' ? 'Виды расходов' :
                 activeTab === 'materials' ? 'Материалы' :
                 activeTab === 'units' ? 'Единицы измерения' :
                 activeTab === 'drivers' ? 'Водители' :
                 'Перевозчики'}
              </h2>
              <p className={cn("text-[10px] font-bold uppercase tracking-widest opacity-40 mt-1", "text-[#141414]")}>
                {activeTab === 'companies' ? companies.length : 
                 activeTab === 'contacts' ? contacts.length : 
                 activeTab === 'expense_categories' ? expenseCategories.length :
                 activeTab === 'materials' ? materials.length :
                 activeTab === 'units' ? units.length :
                 activeTab === 'drivers' ? drivers.length :
                 carriers.length} записей
              </p>
            </div>

            <div className="flex items-center gap-4 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className={cn("absolute left-4 top-1/2 -translate-y-1/2", "text-[#141414]/20")} size={16} />
                <input 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск..."
                  className={cn(
                    "w-full rounded-2xl pl-10 pr-4 py-2 text-sm transition-all font-medium border-none",
                    "bg-[#F5F5F0] text-[#141414]"
                  )}
                />
              </div>
              <button 
                onClick={() => setShowAddModal(true)}
                className={cn(
                  "px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all active:scale-95 shadow-lg",
                  "bg-[#141414] text-white hover:bg-black"
                )}
              >
                <Plus size={14} strokeWidth={3} />
                Добавить
              </button>
            </div>
          </div>

          {/* Content Table */}
          <div className="flex-1 overflow-x-auto">
            {activeTab === 'companies' ? (
              <CompaniesTable companies={filteredCompanies} />
            ) : activeTab === 'contacts' ? (
              <ContactsTable contacts={filteredContacts} companies={companies} />
            ) : activeTab === 'materials' ? (
              <MaterialsTable items={filteredMaterials} />
            ) : activeTab === 'units' ? (
              <GenericDirectoryTable items={filteredUnits} collectionName="units" title="НАИМЕНОВАНИЕ" icon={<Maximize size={18} />} />
            ) : activeTab === 'drivers' ? (
              <GenericDirectoryTable items={filteredDrivers} collectionName="drivers" title="НАИМЕНОВАНИЕ" icon={<User size={18} />} />
            ) : activeTab === 'carriers' ? (
              <CarriersTable items={filteredCarriers} />
            ) : (
              <ExpenseCategoriesTable categories={filteredExp} />
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-[#000]/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                "relative w-full max-w-lg rounded-2xl shadow-2xl p-10 overflow-hidden border transition-colors",
                "bg-white border-[#141414]/10"
              )}
            >
              <button 
                onClick={() => setShowAddModal(false)}
                className={cn(
                  "absolute top-8 right-8 p-3 rounded-full transition-colors",
                  "hover:bg-[#141414]/5 text-[#141414]/40 hover:text-[#141414]"
                )}
              >
                <X size={20} />
              </button>

              <h3 className={cn("text-3xl font-serif font-medium mb-10", "text-[#141414]")}>
                {activeTab === 'companies' ? 'Добавить компанию' : 
                 activeTab === 'contacts' ? 'Новый контакт' : 
                 activeTab === 'expense_categories' ? 'Новый вид расхода' :
                 activeTab === 'materials' ? 'Новый материал' :
                 activeTab === 'units' ? 'Новая ед. измерения' :
                 activeTab === 'drivers' ? 'Новый водитель' :
                 'Новый перевозчик'}
              </h3>

              <div className="space-y-6">
                {(activeTab === 'materials' || activeTab === 'units' || activeTab === 'drivers' || activeTab === 'carriers') && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Название</label>
                      <input 
                        value={newDirectoryItemName}
                        onChange={e => setNewDirectoryItemName(e.target.value)}
                        placeholder="Введите название..."
                        className={cn(
                          "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all font-serif text-lg",
                          "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30 shadow-sm"
                        )}
                      />
                    </div>
                    {activeTab === 'materials' && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Бренд</label>
                          <input 
                            value={newMaterialDetails.brand}
                            onChange={e => setNewMaterialDetails({...newMaterialDetails, brand: e.target.value})}
                            className={cn("w-full border-none rounded-2xl px-6 py-3 text-sm", "bg-[#F5F5F0]")}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Страна</label>
                          <input 
                            value={newMaterialDetails.country}
                            onChange={e => setNewMaterialDetails({...newMaterialDetails, country: e.target.value})}
                            className={cn("w-full border-none rounded-2xl px-6 py-3 text-sm", "bg-[#F5F5F0]")}
                          />
                        </div>
                      </div>
                    )}
                    {activeTab === 'carriers' && (
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Контактное лицо</label>
                          <input 
                            value={newCarrierDetails.contactPerson}
                            onChange={e => setNewCarrierDetails({...newCarrierDetails, contactPerson: e.target.value})}
                            className={cn("w-full border-none rounded-2xl px-6 py-3 text-sm", "bg-[#F5F5F0]")}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Телефон</label>
                            <input 
                              value={newCarrierDetails.phone}
                              onChange={e => setNewCarrierDetails({...newCarrierDetails, phone: e.target.value})}
                              className={cn("w-full border-none rounded-2xl px-6 py-3 text-sm", "bg-[#F5F5F0]")}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Email</label>
                            <input 
                              value={newCarrierDetails.email}
                              onChange={e => setNewCarrierDetails({...newCarrierDetails, email: e.target.value})}
                              className={cn("w-full border-none rounded-2xl px-6 py-3 text-sm", "bg-[#F5F5F0]")}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {activeTab === 'companies' && (
                  <div className="space-y-2">
                    <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Название компании</label>
                    <input 
                      value={newCompanyName}
                      onChange={e => setNewCompanyName(e.target.value)}
                      placeholder="Введите название..."
                      className={cn(
                        "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all font-serif text-lg",
                        "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                      )}
                    />
                  </div>
                )}

                {activeTab === 'expense_categories' && (
                  <div className="space-y-2">
                    <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Название вида расхода</label>
                    <input 
                      value={newExpCategoryName}
                      onChange={e => setNewExpCategoryName(e.target.value)}
                      placeholder="Например: Аренда спецтехники"
                      className={cn(
                        "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all font-serif text-lg",
                        "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                      )}
                    />
                  </div>
                )}

                {activeTab === 'contacts' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>ФИО</label>
                      <input 
                        value={newContact.name}
                        onChange={e => setNewContact({...newContact, name: e.target.value})}
                        className={cn(
                          "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all",
                          "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                        )}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Компания</label>
                      <select 
                        value={newContact.companyId}
                        onChange={e => setNewContact({...newContact, companyId: e.target.value})}
                        className={cn(
                          "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all appearance-none",
                          "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                        )}
                      >
                        <option value="" className={"bg-white"}>Выберите компанию...</option>
                        {companies.map(c => <option key={c.id} value={c.id} className={"bg-white"}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className={cn("grid grid-cols-2 gap-4", activeTab === 'contacts' ? "" : "hidden")}>
                      <div className="space-y-2">
                        <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Должность</label>
                        <input 
                          value={newContact.position}
                          onChange={e => setNewContact({...newContact, position: e.target.value})}
                          className={cn(
                            "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all text-xs",
                            "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                          )}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={cn("text-[10px] font-bold uppercase tracking-widest ml-4", "text-[#141414]/20")}>Телефон</label>
                        <input 
                          value={newContact.phone}
                          onChange={e => setNewContact({...newContact, phone: e.target.value})}
                          className={cn(
                            "w-full border-none rounded-2xl px-6 py-4 font-medium transition-all text-xs",
                            "bg-[#F5F5F0] text-[#141414] focus:ring-[#5A5A40]/30"
                          )}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <button 
                  onClick={async () => {
                    try {
                      if (activeTab === 'companies' && newCompanyName) {
                        await addDoc(collection(db, 'companies'), { 
                          name: newCompanyName, 
                          createdAt: serverTimestamp(),
                          managerId: auth.currentUser?.uid
                        });
                        setNewCompanyName('');
                      } else if (activeTab === 'expense_categories' && newExpCategoryName) {
                        await addDoc(collection(db, 'expense_categories'), { 
                          name: newExpCategoryName, 
                          createdAt: serverTimestamp() 
                        });
                        setNewExpCategoryName('');
                      } else if (['materials', 'units', 'drivers', 'carriers'].includes(activeTab) && newDirectoryItemName) {
                        const extraData = activeTab === 'materials' ? newMaterialDetails : activeTab === 'carriers' ? newCarrierDetails : {};
                        await addDoc(collection(db, activeTab), { 
                          name: newDirectoryItemName, 
                          ...extraData,
                          createdAt: serverTimestamp() 
                        });
                        setNewDirectoryItemName('');
                        setNewMaterialDetails({ brand: '', country: '', article: '' });
                        setNewCarrierDetails({ contactPerson: '', phone: '', email: '' });
                      } else if (activeTab === 'contacts' && newContact.name && newContact.companyId) {
                        await addDoc(collection(db, 'contacts'), { 
                          ...newContact, 
                          createdAt: serverTimestamp() 
                        });
                        setNewContact({ name: '', position: '', phone: '', companyId: '' });
                      }
                      setShowAddModal(false);
                    } catch (error) {
                      handleFirestoreError(error, OperationType.WRITE, activeTab);
                    }
                  }}
                  className={cn(
                    "w-full py-5 px-6 rounded-full font-bold text-lg transition-all active:scale-95 shadow-xl",
                    "bg-[#141414] text-white hover:bg-black shadow-black/10"
                  )}
                >
                  Записать в справочник
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CompaniesTable({ companies }: { companies: Company[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const saveEdit = async (id: string) => {
    try {
      await updateDoc(doc(db, 'companies', id), { name: editName });
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `companies/${id}`);
    }
  };

  const deleteCompany = async (id: string) => {
    if (confirm('Вы уверены? Это может повлиять на связанные проекты.')) {
      try {
        await deleteDoc(doc(db, 'companies', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `companies/${id}`);
      }
    }
  };

  return (
    <table className="w-full text-left">
      <thead className={cn(
        "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors border-y",
        "bg-[#F5F5F0] text-[#141414]/20 border-[#141414]/5"
      )}>
        <tr>
          <th className="px-8 py-5">НАИМЕНОВАНИЕ</th>
          <th className="px-8 py-5">ID ЗАПИСИ</th>
          <th className="px-8 py-5 text-right whitespace-nowrap">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody className={cn("divide-y", "divide-[#141414]/5")}>
        {companies.map(company => (
          <tr key={company.id} className={cn("transition-colors group", "hover:bg-[#141414]/5")}>
            <td className="px-8 py-5">
              {editingId === company.id ? (
                <div className="flex items-center gap-3">
                  <input 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className={cn(
                      "border-none rounded-xl px-4 py-2 w-full font-medium transition-all text-sm",
                      "bg-[#F5F5F0] text-[#141414]"
                    )}
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button onClick={() => saveEdit(company.id)} className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"><Save size={16} /></button>
                    <button onClick={() => setEditingId(null)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"><X size={16} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-sm",
                    "bg-[#F5F5F0] text-[#B48444]"
                  )}>
                    <Briefcase size={16} />
                  </div>
                  <span className={cn("font-medium text-sm", "text-[#141414]")}>{company.name}</span>
                </div>
              )}
            </td>
            <td className={cn("px-8 py-5 font-mono text-[10px]", "text-[#141414]/40")}>{company.id}</td>
            <td className="px-8 py-5 text-right">
              <div className={cn("flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity", "text-[#141414]/40")}>
                <button 
                  onClick={() => { setEditingId(company.id); setEditName(company.name); }} 
                  className={cn("p-2 rounded-xl transition-all", "hover:bg-[#141414]/5 hover:text-[#141414]")}
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={() => deleteCompany(company.id)} 
                  className="p-2 rounded-xl hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ContactsTable({ contacts, companies }: { contacts: Contact[], companies: Company[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Contact>>({});

  const saveEdit = async (id: string) => {
    try {
      await updateDoc(doc(db, 'contacts', id), editData);
      setEditingId(null);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <table className="w-full text-left">
      <thead className={cn(
        "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors border-y",
        "bg-[#F5F5F0] text-[#141414]/20 border-[#141414]/5"
      )}>
        <tr>
          <th className="px-8 py-5">НАИМЕНОВАНИЕ</th>
          <th className="px-8 py-5">КОМПАНИЯ</th>
          <th className="px-8 py-5">ДОЛЖНОСТЬ / ТЕЛЕФОН</th>
          <th className="px-8 py-5 text-right whitespace-nowrap">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody className={cn("divide-y", "divide-[#141414]/5")}>
        {contacts.map(contact => (
          <tr key={contact.id} className={cn("transition-colors group", "hover:bg-[#141414]/5")}>
            <td className="px-8 py-5">
              {editingId === contact.id ? (
                <input 
                  value={editData.name || ''}
                  onChange={e => setEditData({...editData, name: e.target.value})}
                  className={cn(
                    "border-none rounded-xl px-4 py-2 w-full font-medium text-sm",
                    "bg-[#F5F5F0] text-[#141414]"
                  )}
                />
              ) : (
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-sm",
                    "bg-[#F5F5F0] text-[#B48444]"
                  )}>
                    <User size={16} />
                  </div>
                  <span className={cn("font-medium text-sm", "text-[#141414]")}>{contact.name}</span>
                </div>
              )}
            </td>
            <td className="px-8 py-5">
              <span className={cn("text-xs font-bold uppercase tracking-wider", "text-[#141414]/40")}>
                {companies.find(c => c.id === contact.companyId)?.name || '—'}
              </span>
            </td>
            <td className="px-8 py-5 space-y-1">
              {editingId === contact.id ? (
                <div className="space-y-2">
                  <input 
                    value={editData.position || ''}
                    onChange={e => setEditData({...editData, position: e.target.value})}
                    placeholder="Должность"
                    className={cn(
                      "border-none rounded-xl px-4 py-1 text-xs w-full",
                      "bg-[#F5F5F0] text-[#141414]"
                    )}
                  />
                  <input 
                    value={editData.phone || ''}
                    onChange={e => setEditData({...editData, phone: e.target.value})}
                    placeholder="Телефон"
                    className={cn(
                      "border-none rounded-xl px-4 py-1 text-xs w-full",
                      "bg-[#F5F5F0] text-[#141414]"
                    )}
                  />
                  <div className="flex gap-1 mt-2">
                    <button onClick={() => saveEdit(contact.id)} className="p-1 px-2 bg-emerald-500/10 text-emerald-500 rounded text-[10px] font-bold">СОХРАНИТЬ</button>
                    <button onClick={() => setEditingId(null)} className="p-1 px-2 bg-rose-500/10 text-rose-500 rounded text-[10px] font-bold">ОТМЕНА</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className={cn("text-[10px] font-bold uppercase tracking-wider opacity-40", "text-[#141414]")}>{contact.position || '—'}</p>
                  <p className={cn("text-xs font-mono", "text-[#B48444]")}>{contact.phone || '—'}</p>
                </>
              )}
            </td>
            <td className="px-8 py-5 text-right">
              <div className={cn("flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity", "text-[#141414]/40")}>
                {editingId !== contact.id && (
                  <>
                    <button 
                      onClick={() => { setEditingId(contact.id); setEditData(contact); }} 
                      className={cn("p-2 rounded-xl transition-all", "hover:bg-[#141414]/5 hover:text-[#141414]")}
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={async () => { if(confirm('Удалить контакт?')) await deleteDoc(doc(db, 'contacts', contact.id)); }} 
                      className="p-2 rounded-xl hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpenseCategoriesTable({ categories }: { categories: ExpenseCategory[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const saveEdit = async (id: string) => {
    try {
      await updateDoc(doc(db, 'expense_categories', id), { name: editName });
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `expense_categories/${id}`);
    }
  };

  const deleteCategory = async (id: string) => {
    if (confirm('Вы уверены?')) {
      try {
        await deleteDoc(doc(db, 'expense_categories', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `expense_categories/${id}`);
      }
    }
  };

  return (
    <table className="w-full text-left">
      <thead className={cn(
        "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors border-y",
        "bg-[#F5F5F0] text-[#141414]/20 border-[#141414]/5"
      )}>
        <tr>
          <th className="px-8 py-5">НАИМЕНОВАНИЕ</th>
          <th className="px-8 py-5">ID ЗАПИСИ</th>
          <th className="px-8 py-5 text-right whitespace-nowrap">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody className={cn("divide-y", "divide-[#141414]/5")}>
        {categories.map(category => (
          <tr key={category.id} className={cn("transition-colors group", "hover:bg-[#141414]/5")}>
            <td className="px-8 py-5">
              {editingId === category.id ? (
                <div className="flex items-center gap-3">
                  <input 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className={cn(
                      "border-none rounded-xl px-4 py-2 w-full font-medium transition-all text-sm",
                      "bg-[#F5F5F0] text-[#141414]"
                    )}
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button onClick={() => saveEdit(category.id)} className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"><Save size={16} /></button>
                    <button onClick={() => setEditingId(null)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"><X size={16} /></button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-sm",
                    "bg-[#F5F5F0] text-[#B48444]"
                  )}>
                    <Wallet size={16} />
                  </div>
                  <span className={cn("font-medium text-sm", "text-[#141414]")}>{category.name}</span>
                </div>
              )}
            </td>
            <td className={cn("px-8 py-5 font-mono text-[10px]", "text-[#141414]/40")}>{category.id}</td>
            <td className="px-8 py-5 text-right">
              <div className={cn("flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity", "text-[#141414]/40")}>
                <button 
                  onClick={() => { setEditingId(category.id); setEditName(category.name); }} 
                  className={cn("p-2 rounded-xl transition-all", "hover:bg-[#141414]/5 hover:text-[#141414]")}
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={() => deleteCategory(category.id)} 
                  className="p-2 rounded-xl hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MaterialsTable({ items }: { items: Material[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Material>>({});

  const saveEdit = async (id: string) => {
    try {
      await updateDoc(doc(db, 'materials', id), editData);
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `materials/${id}`);
    }
  };

  return (
    <table className="w-full text-left font-serif">
      <thead className={cn(
        "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors border-y",
        "bg-[#F5F5F0] text-[#141414]/20 border-[#141414]/5"
      )}>
        <tr>
          <th className="px-8 py-5">МАТЕРИАЛ</th>
          <th className="px-8 py-5">БРЕНД / СТРАНА</th>
          <th className="px-8 py-5">ID ЗАПИСИ</th>
          <th className="px-8 py-5 text-right whitespace-nowrap">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody className={cn("divide-y", "divide-[#141414]/5")}>
        {items.map(item => (
          <tr key={item.id} className={cn("transition-colors group", "hover:bg-[#141414]/5")}>
            <td className="px-8 py-5">
              {editingId === item.id ? (
                <input 
                  value={editData.name || ''}
                  onChange={e => setEditData({...editData, name: e.target.value})}
                  className={cn("bg-transparent border-none w-full font-medium text-lg", "text-[#141414]")}
                />
              ) : (
                <div className="flex items-center gap-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-sm", "bg-[#F5F5F0] text-[#B48444]")}>
                    <Layers size={16} />
                  </div>
                  <span className={cn("font-medium text-sm", "text-[#141414]")}>{item.name}</span>
                </div>
              )}
            </td>
            <td className="px-8 py-5">
              {editingId === item.id ? (
                <div className="flex gap-2">
                  <input value={editData.brand || ''} onChange={e => setEditData({...editData, brand: e.target.value})} placeholder="Бренд" className="bg-transparent border-none text-xs w-24" />
                  <input value={editData.country || ''} onChange={e => setEditData({...editData, country: e.target.value})} placeholder="Страна" className="bg-transparent border-none text-xs w-24" />
                </div>
              ) : (
                <div className="flex flex-col">
                  <span className={cn("text-[10px] font-bold uppercase tracking-widest", "text-[#141414]/40")}>{item.brand || '—'}</span>
                  <span className="text-xs opacity-60">{item.country || '—'}</span>
                </div>
              )}
            </td>
            <td className={cn("px-8 py-5 font-mono text-[10px]", "text-[#141414]/40")}>{item.id}</td>
            <td className="px-8 py-5 text-right">
              {editingId === item.id ? (
                <div className="flex justify-end gap-1">
                  <button onClick={() => saveEdit(item.id)} className="p-2 text-emerald-500"><Save size={16} /></button>
                  <button onClick={() => setEditingId(null)} className="p-2 text-rose-500"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingId(item.id); setEditData(item); }} className="p-2 opacity-40 hover:opacity-100"><Edit2 size={16} /></button>
                  <button onClick={async () => { if(confirm('Удалить?')) await deleteDoc(doc(db, 'materials', item.id)); }} className="p-2 text-rose-500/40 hover:text-rose-500"><Trash2 size={16} /></button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CarriersTable({ items }: { items: Carrier[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Carrier>>({});

  const saveEdit = async (id: string) => {
    try {
      await updateDoc(doc(db, 'carriers', id), editData);
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `carriers/${id}`);
    }
  };

  return (
    <table className="w-full text-left">
      <thead className={cn(
        "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors border-y",
        "bg-[#F5F5F0] text-[#141414]/20 border-[#141414]/5"
      )}>
        <tr>
          <th className="px-8 py-5">ПЕРЕВОЗЧИК</th>
          <th className="px-8 py-5">КОНТАКТ / ТЕЛЕФОН</th>
          <th className="px-8 py-5">EMAIL</th>
          <th className="px-8 py-5 text-right">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody className={cn("divide-y", "divide-[#141414]/5")}>
        {items.map(item => (
          <tr key={item.id} className={cn("transition-colors group", "hover:bg-[#141414]/5")}>
            <td className="px-8 py-5">
              {editingId === item.id ? (
                <input value={editData.name || ''} onChange={e => setEditData({...editData, name: e.target.value})} className="bg-transparent border-none w-full font-medium" />
              ) : (
                <div className="flex items-center gap-4">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-sm", "bg-[#F5F5F0] text-[#B48444]")}>
                    <Truck size={16} />
                  </div>
                  <span className={cn("font-medium text-sm", "text-[#141414]")}>{item.name}</span>
                </div>
              )}
            </td>
            <td className="px-8 py-5">
              {editingId === item.id ? (
                <div className="flex flex-col gap-1">
                  <input value={editData.contactPerson || ''} onChange={e => setEditData({...editData, contactPerson: e.target.value})} placeholder="ФИО" className="bg-transparent border-none text-xs" />
                  <input value={editData.phone || ''} onChange={e => setEditData({...editData, phone: e.target.value})} placeholder="Телефон" className="bg-transparent border-none text-xs" />
                </div>
              ) : (
                <div className="flex flex-col">
                  <span className={cn("text-[10px] font-bold uppercase tracking-widest", "text-[#141414]/40")}>{item.contactPerson || '—'}</span>
                  <span className="text-xs opacity-60 font-mono">{item.phone || '—'}</span>
                </div>
              )}
            </td>
            <td className="px-8 py-5">
              {editingId === item.id ? (
                <input value={editData.email || ''} onChange={e => setEditData({...editData, email: e.target.value})} className="bg-transparent border-none text-xs w-full" />
              ) : (
                <span className="text-xs opacity-40">{item.email || '—'}</span>
              )}
            </td>
            <td className="px-8 py-5 text-right">
              {editingId === item.id ? (
                <div className="flex justify-end gap-1">
                  <button onClick={() => saveEdit(item.id)} className="p-2 text-emerald-500"><Save size={16} /></button>
                  <button onClick={() => setEditingId(null)} className="p-2 text-rose-500"><X size={16} /></button>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingId(item.id); setEditData(item); }} className="p-2 opacity-40 hover:opacity-100"><Edit2 size={16} /></button>
                  <button onClick={async () => { if(confirm('Удалить?')) await deleteDoc(doc(db, 'carriers', item.id)); }} className="p-2 text-rose-500/40 hover:text-rose-500"><Trash2 size={16} /></button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GenericDirectoryTable({ items, collectionName, title, icon }: { items: any[], collectionName: string, title: string, icon: React.ReactNode }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const saveEdit = async (id: string) => {
    try {
      const updates: any = { name: editName };
      if (collectionName === 'drivers') updates.phone = editPhone;
      await updateDoc(doc(db, collectionName, id), updates);
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `${collectionName}/${id}`);
    }
  };

  const deleteItem = async (id: string) => {
    if (confirm('Вы уверены?')) {
      try {
        await deleteDoc(doc(db, collectionName, id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
      }
    }
  };

  return (
    <table className="w-full text-left">
      <thead className={cn(
        "text-[9px] font-bold uppercase tracking-[0.2em] transition-colors border-y",
        "bg-[#F5F5F0] text-[#141414]/20 border-[#141414]/5"
      )}>
        <tr>
          <th className="px-8 py-5">{title}</th>
          {collectionName === 'drivers' && <th className="px-8 py-5">ТЕЛЕФОН</th>}
          <th className="px-8 py-5">ID ЗАПИСИ</th>
          <th className="px-8 py-5 text-right whitespace-nowrap">ДЕЙСТВИЯ</th>
        </tr>
      </thead>
      <tbody className={cn("divide-y", "divide-[#141414]/5")}>
        {items.map(item => (
          <tr key={item.id} className={cn("transition-colors group", "hover:bg-[#141414]/5")}>
            <td className="px-8 py-5">
              {editingId === item.id ? (
                <div className="flex items-center gap-3">
                  <input 
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className={cn(
                      "border-none rounded-xl px-4 py-2 w-full font-medium transition-all text-sm",
                      "bg-[#F5F5F0] text-[#141414]"
                    )}
                    autoFocus
                  />
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-colors shadow-sm",
                    "bg-[#F5F5F0] text-[#B48444]"
                  )}>
                    {icon}
                  </div>
                  <span className={cn("font-medium text-sm", "text-[#141414]")}>{item.name}</span>
                </div>
              )}
            </td>
            {collectionName === 'drivers' && (
              <td className="px-8 py-5">
                {editingId === item.id ? (
                  <input 
                    value={editPhone}
                    onChange={e => setEditPhone(e.target.value)}
                    className={cn("bg-transparent border-none text-sm font-mono", "text-[#141414]")}
                    placeholder="Телефон"
                  />
                ) : (
                  <span className="text-xs font-mono opacity-60">{item.phone || '—'}</span>
                )}
              </td>
            )}
            <td className={cn("px-8 py-5 font-mono text-[10px]", "text-[#141414]/40")}>{item.id}</td>
            <td className="px-8 py-5 text-right">
              {editingId === item.id ? (
                <div className="flex justify-end gap-1">
                  <button onClick={() => saveEdit(item.id)} className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg"><Save size={16} /></button>
                  <button onClick={() => setEditingId(null)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg"><X size={16} /></button>
                </div>
              ) : (
                <div className={cn("flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity", "text-[#141414]/40")}>
                  <button 
                    onClick={() => { setEditingId(item.id); setEditName(item.name); setEditPhone(item.phone || ''); }} 
                    className={cn("p-2 rounded-xl transition-all", "hover:bg-[#141414]/5 hover:text-[#141414]")}
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => deleteItem(item.id)} 
                    className="p-2 rounded-xl hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CategoryButton({ active, onClick, label, count, icon }: { active: boolean, onClick: () => void, label: string, count: number, icon: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-4 py-4 rounded-2xl transition-all group relative",
        active 
          ? ("bg-[#141414] text-white shadow-lg shadow-black/10")
          : ("text-[#141414]/40 hover:bg-[#F5F5F0] hover:text-[#141414]")
      )}
    >
      <div className="flex items-center gap-4">
        <div className={cn(
          "w-8 h-8 rounded-xl flex items-center justify-center transition-all",
          active 
            ? ("text-white/40")
            : ("text-[#141414]/10 group-hover:text-[#141414]/20")
        )}>
          {icon}
        </div>
        <span className="text-[11px] font-bold uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn(
          "text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg",
          active 
            ? ("bg-white/10 text-white")
            : ("bg-[#141414]/5 text-[#141414]/20")
        )}>
          {count}
        </span>
        {active && <ChevronRight size={14} className="opacity-40" />}
      </div>
    </button>
  );
}
