export type ProjectStatus = 'in_progress' | 'shipping' | 'done' | 'canceled';

export const STATUS_LIST: ProjectStatus[] = ['in_progress', 'shipping', 'done', 'canceled'];

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  in_progress: 'В работе',
  shipping:    'Отгрузки',
  done:        'Завершён',
  canceled:    'Отменён',
};

export const STATUS_COLOR: Record<ProjectStatus, string> = {
  in_progress: '#3b4a55',
  shipping:    '#5a6b3c',
  done:        '#2f5e3f',
  canceled:    '#a04930',
};

export const STATUS_BG: Record<ProjectStatus, string> = {
  in_progress: '#d8dfe3',
  shipping:    '#e1e3cf',
  done:        '#d2e3d3',
  canceled:    '#f1d9cf',
};
