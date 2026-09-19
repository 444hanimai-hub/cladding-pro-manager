export interface Company {
  id: string;
  name: string;
  managerId: string;
}

export interface Contact {
  id: string;
  companyId: string;
  name: string;
  position: string;
  phone: string;
  createdAt: any;
}

export interface StakeholderGroup {
  companyId?: string;
  companyName: string;
  contactIds: string[];
}

export interface ResourceItem {
  id: string;
  name: string;
  quantity: number;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  categoryId?: string;
  amount: number;
}

export interface DirectoryItem {
  id: string;
  name: string;
}

export interface ExpenseCategory extends DirectoryItem {}
export interface Material extends DirectoryItem {
  brand?: string;
  country?: string;
  article?: string;
}
export interface Unit extends DirectoryItem {}
export interface Driver extends DirectoryItem {
  phone?: string;
}
export interface Carrier extends DirectoryItem {
  contactPerson?: string;
  phone?: string;
  email?: string;
}

export interface FinanceData {
  contractSum: number;
  managerPercentage: number;
  expenses: Expense[];
}

export interface Shipment {
  id: string;
  docType: 'upd' | 'act';
  incomingUPD: string;
  outgoingUPD: string;
  scanSentToAccounting: boolean | 'yes' | 'no' | 'empty';
  poaNumber: string;
  poaDate: string;
  autoNumber: string;
  carrierId: string;
  carrierName: string;
  loadingDate: string;
  unloadingDate: string;
  driverId: string;
  driverName: string;
  materialId?: string;
  materialName: string;
  quantity: number;
  carryingCost: number;
  totalCarryingCost: number;
  carrierInvoice: string;
  carrierUPD: string;
  createdAt?: any;
}

export interface ProjectMaterial {
  id: string;
  materialId?: string;
  materialName: string;
  quantity: number;
  unitId?: string;
  unitName: string;
  deliveryMonth?: string;
  supplierId?: string;
  supplierName: string;
  supplierContactId?: string;
}

/**
 * Доверенность на получение/перевозку груза.
 *
 * Хранится в единой коллекции верхнего уровня `trust_deeds` (не как подколлекция
 * внутри проекта) — так номер доверенности можно сделать сквозным по всей системе,
 * а не только в рамках одного проекта. Связь с проектом — через поле projectId.
 *
 * Уникальность номера (поле number) гарантируется отдельной служебной коллекцией
 * trust_deed_numbers (документ с ID = номеру), которая создаётся/удаляется атомарно
 * вместе с самой доверенностью в транзакции — см. lib/trustDeedNumbering.ts.
 *
 * Поле supplierName сознательно отсутствует: поставщик всегда берётся из материала
 * проекта (ProjectMaterial.supplierName), а не хранится отдельно в доверенности —
 * это раньше приводило к рассинхронизации данных.
 */
export interface TrustDeed {
  id: string;
  projectId: string;
  number: string;
  issueDate: string;
  expiryDate: string;
  supplierId: string;
  customerName: string;
  carrierId: string;
  carrierName: string;
  accountNumber: string;
  accountDate?: string;
  rate: number;
  driverId: string;
  driverName: string;
  driverPassportSeries: string;
  driverPassportNumber: string;
  driverPassportIssuedBy?: string;
  driverPassportIssuedDate?: string;
  materialId: string;
  materialName: string;
  quantity: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface Project {
  id: string;
  name: string;
  address: string;
  client: string; // Legacy field, keeping for compatibility but will use stakeholders.client
  deadline?: any;
  status: 'lead' | 'active' | 'completed' | 'cancelled' | 'in_progress' | 'shipping' | 'done' | 'canceled';
  stakeholders: {
    client?: StakeholderGroup;
    generalContractor?: StakeholderGroup;
    subcontractor?: StakeholderGroup;
    architect?: StakeholderGroup;
  };
  resources: ResourceItem[];
  finance: FinanceData;
  /** Юр. лицо, через которое продаём по этому проекту — компания из справочника с companyType "Юр лицо для продажи" */
  sellerLegalEntityId?: string;
  sellerLegalEntityName?: string;
  materials?: ProjectMaterial[];
  allMaterialsSingleSupplier?: boolean;
  shipments?: Shipment[];
  managerId: string;
  leadManagerId?: string;
  leadManagerName?: string;
  createdAt: any;
  updatedAt: any;
  completedAt?: any;
  actualCompletionDate?: any;
  completed?: any;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  date?: string;
  time?: string;
  dueDate?: any;
  completed: boolean;
  type: 'task' | 'reminder';
  order?: number;
  createdAt?: any;
}

export interface ProjectEvent {
  id: string;
  projectId: string;
  title: string;
  date: any;
  time?: string;
  location?: string;
  type: 'past' | 'planned';
  notes: string;
}

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  // New section-based permissions
  accessDashboard: boolean;
  fullProjectAccess: boolean;
  accessDirectories: boolean;
  accessSettings: boolean;
  // Legacy fields (optional compatibility)
  hasFinanceAccess?: boolean;
  projectsAccess?: { [projectId: string]: 'view' | 'edit' };
  financeCode?: string;
  requireFinanceCode?: boolean;
  createdAt?: any;
}