import { ProjectTask, Project } from '../types';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

const pad = (n: number) => String(n).padStart(2, '0');

/** Дата задачи в формате YYYY-MM-DD для Calendar API */
export function normalizeTaskDateForCalendar(date: unknown): string | null {
  if (date == null || date === '') return null;

  if (typeof date === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
    }
    return null;
  }

  if (typeof date === 'object' && 'toDate' in date && typeof (date as { toDate: () => Date }).toDate === 'function') {
    const d = (date as { toDate: () => Date }).toDate();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  return null;
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function isCalendarAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /401|403|invalid|expired|unauthorized|forbidden|insufficient/i.test(msg);
}

/** Проверяет токен тем же API, что и создание событий (scope calendar.events) */
export async function verifyCalendarAccess(
  accessToken: string
): Promise<{ valid: boolean; unauthorized: boolean }> {
  try {
    const response = await fetch(
      `${CALENDAR_API_BASE}/calendars/primary/events?maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return {
      valid: response.ok,
      unauthorized: response.status === 401 || response.status === 403,
    };
  } catch {
    return { valid: false, unauthorized: false };
  }
}

export const createCalendarEvent = async (accessToken: string, project: Project, task: Partial<ProjectTask>) => {
  const dateIso = normalizeTaskDateForCalendar(task.date);
  if (!dateIso) return null;

  try {
    const event: Record<string, unknown> = {
      summary: `${project.name}: ${task.title}`,
      description: `Задача по проекту ${project.name}. Адрес: ${project.address || 'не указан'}. Заказчик: ${project.client || 'не указан'}.`,
      location: project.address || '',
      reminders: {
        useDefault: true,
      },
    };

    const time = task.time?.trim();

    if (time && /^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
      const startDateTime = `${dateIso}T${time}:00`;
      const startDate = new Date(startDateTime);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      const endDateTime = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}`;

      event.start = {
        dateTime: startDateTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      event.end = {
        dateTime: endDateTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    } else {
      event.start = { date: dateIso };
      event.end = { date: addDaysToIsoDate(dateIso, 1) };
    }

    const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { error?: { message?: string } }).error?.message ||
        response.statusText ||
        'Unknown error';
      throw new Error(`Calendar API error (${response.status}): ${errorMessage}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
};
