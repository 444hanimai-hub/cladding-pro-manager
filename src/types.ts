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

/** Документ-подтверждение расхода, хранится на Google Drive — здесь только ссылка. */
export interface ExpenseReceiptFile {
  id: string;
  driveFileId: string;
  driveFileLink: string;
  fileName: string;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  categoryId?: string;
  amount: number;
  description?: string;
  /** % от прибыли — только для категории "Бонус менеджера", где сумма считается автоматически. */
  managerPercent?: number;
  receipts?: ExpenseReceiptFile[];
}

export interface DirectoryItem {
  id: string;
  name: string;
}

export interface ExpenseCategory extends DirectoryItem {}

/** Вид товара (справочник) — например "Кирпич", "Керамогранит". Заводится ТОЛЬКО
 * через раздел «Справочники»; на форме материала — строго выбор из существующих,
 * без возможности создать новый прямо там (в отличие от большинства других полей),
 * так как на конкретные виды товара завязана бизнес-логика (см. MaterialsTab —
 * специальная раскладка формы и расчёт количества для вида "Кирпич"). */
export interface ProductType extends DirectoryItem {}

export interface Material extends DirectoryItem {
  /** Вид товара — ссылка на справочник ProductType (id и денормализованное имя) */
  productTypeId?: string;
  productTypeName?: string;
  /** Характеристики — например "1 НФ 250*120*65мм, Цвет: PATINA GREEN BROWN..." */
  characteristics?: string;
  /** Производитель — ссылка на companies с companyType = "Производитель" */
  manufacturerId?: string;
  manufacturerName?: string;
  /** Кол-во штук в 1 м² — используется для пересчёта м²↔шт для видов товара типа "Кирпич" */
  qtyPerM2?: number;
  /** Кол-во штук в поддоне — используется для расчёта количества поддонов */
  qtyPerPallet?: number;
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

/**
 * Позиция сметы (материал проекта). Помимо самого товара хранит полный набор
 * данных для расчёта закупа, продажи, услуг (дизайнер/ГенПодрядчик/транспорт)
 * и итоговой маржи по формулам ТЗ — см. lib/materialFinance.ts, где считаются
 * все производные суммы (эти поля НЕ хранятся, а вычисляются на лету).
 *
 * Поле salePrice — источник истины для цены продажи; markupPercent (% накрутки)
 * нигде не хранится, а всегда пересчитывается из purchasePrice/salePrice —
 * это исключает рассинхронизацию между %-полем и ценой при повторном открытии формы.
 */
export interface ProjectMaterial {
  id: string;
  materialId?: string;
  materialName: string;
  /**
   * Финальное количество, идущее во все расчёты закупа/продажи (не менялось —
   * для обычных материалов это просто введённое число, для видов товара с
   * расчётом по поддонам (см. quantityPallets) сюда автоматически попадает
   * "количество шт кратно поддону").
   */
  quantity: number;
  unitId?: string;
  unitName: string;
  supplierId?: string;
  supplierName: string;

  /**
   * Поля ниже заполняются только для материалов, у которых в справочнике указан
   * вид товара с расчётом по м²/поддонам (сейчас — "Кирпич"). Хранятся отдельно
   * от quantity, потому что quantity — это уже округлённое под поддон число, и
   * при повторном открытии формы редактирования нужно восстановить именно то,
   * что реально ввёл пользователь, а не обратно вычислять это из quantity.
   */
  quantityM2?: number;        // введённое количество м² (округлено до 1 знака)
  quantityPcsRaw?: number;    // введённое/пересчитанное количество шт ДО округления под поддон
  quantityPallets?: number;   // количество поддонов — фиксируется в момент расчёта (не пересчитывается
  // задним числом, если справочные шт-в-поддоне потом изменятся)

  // Закуп
  purchasePrice: number;        // цена закупа с НДС, за ед.
  purchaseVatPercent: number;   // ставка НДС от закупа, % (по умолчанию 22)

  // Продажа
  salePrice: number;            // цена продажи с НДС, за ед.
  saleVatPercent: number;       // ставка НДС от продажи, % (по умолчанию 22)

  // Услуги
  designerPercent: number;      // % дизайнеру с НДС (по умолчанию 0)
  designerVatPercent: number;   // ставка НДС от вознаграждения дизайнеру, % (по умолчанию 22)
  gcPercent: number;            // % ГенПодрядчику с НДС (по умолчанию 0)
  gcVatPercent: number;         // ставка НДС от вознаграждения ГенПодрядчику, % (по умолчанию 22)
  transportAmount: number;      // транспорт до ТК с НДС, сумма ₽ (по умолчанию 0)
  transportVatPercent: number;  // ставка НДС от транспорта, % (по умолчанию 22)
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
  /**
   * ID файла на Google Drive, куда была сохранена печатная форма этой доверенности.
   * Заполняется после первой успешной загрузки — при повторной печати используется,
   * чтобы ПЕРЕЗАПИСАТЬ тот же файл (PATCH), а не создать дубликат (POST) на Drive.
   */
  driveFileId?: string;
  /** Прямая ссылка на этот файл на Google Drive (webViewLink) — для постоянной кнопки "Открыть документ" в интерфейсе. */
  driveFileLink?: string;
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
  /** Папка проекта с документами на Google Drive — документы хранятся там, в CRM только ссылка. */
  driveDocsFolderId?: string;
  driveDocsFolderLink?: string;
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