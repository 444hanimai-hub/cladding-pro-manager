import { ProjectTask, Project } from '../types';

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';

export const createCalendarEvent = async (accessToken: string, project: any, task: any) => {
  if (!task.date) return null;

  try {
    const pad = (n: number) => String(n).padStart(2, '0');
    const event: any = {
      summary: `${project.name}: ${task.title}`,
      description: `Задача по проекту ${project.name}. Адрес: ${project.address || 'не указан'}. Заказчик: ${project.client || 'не указан'}.`,
      location: project.address || '',
      reminders: {
        useDefault: true,
      },
    };

    if (task.time) {
      const startDateTime = `${task.date}T${task.time}:00`;
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
      // All-day event
      event.start = { date: task.date };
      const startDate = new Date(task.date + 'T00:00:00');
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 1);
      event.end = { 
        date: `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}` 
      };
    }

    const response = await fetch(`${CALENDAR_API_BASE}/calendars/primary/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || response.statusText || 'Unknown error';
      throw new Error(`Calendar API error (${response.status}): ${errorMessage}`);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
};
