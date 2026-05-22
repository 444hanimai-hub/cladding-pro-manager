import React from 'react';
import { cn, getInitials, getUserColor } from '../lib/utils';
import { User as UserIcon } from 'lucide-react';

interface UserAvatarProps {
  name?: string;
  uid?: string;
  photoURL?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

// Сентинельные значения uid, которые означают "это не реальный пользователь".
// 'new' — режим создания нового пользователя в настройках;
// 'unassigned' / 'all' / 'system' / 'none' / '' — фильтры и плейсхолдеры.
const SENTINEL_UIDS = new Set(['', 'unassigned', 'all', 'system', 'none', 'new']);

// Серо-голубой фон для "не назначен" — отдельный от пользовательских цветов,
// чтобы плейсхолдер визуально невозможно было перепутать с реальным человеком.
const UNASSIGNED_BG = '#7A8A9A';

const sizeClasses: Record<NonNullable<UserAvatarProps['size']>, string> = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-[12px]',
  lg: 'w-12 h-12 text-[14px]',
};

const iconSizes: Record<NonNullable<UserAvatarProps['size']>, number> = {
  xs: 12,
  sm: 14,
  md: 18,
  lg: 22,
};

export default function UserAvatar({ name, uid, photoURL, size = 'md', className }: UserAvatarProps) {
  const isSentinelUid = !uid || SENTINEL_UIDS.has(uid);
  const trimmedName = (name ?? '').trim();
  const hasRealName = trimmedName !== '' && trimmedName !== '—';

  // "Не назначен" = нет реального uid И нет реального имени.
  // Если uid пустой, но имя есть (легаси-проекты типа "дом на булаке",
  // где в Firestore сохранилось только leadManagerName) — это всё ещё
  // конкретный человек, и ему нужен свой стабильный цвет.
  const isUnassigned = isSentinelUid && !hasRealName;

  // Сид для стабильного цвета:
  // ПРЕДПОЧИТАЕМ ИМЯ, а не uid — потому что одно и то же имя лежит и в
  // users.displayName, и в project.leadManagerName, тогда как uid может
  // расходиться между коллекциями (пересоздание юзера, переход с temp_ на auth,
  // легаси-данные и т.д.). Имя гарантирует, что один и тот же человек выглядит
  // одинаково везде — в сайдбаре, в настройках, в селектах, в карточках проектов.
  //
  // Запасной путь — uid (для системных/служебных аккаунтов без displayName).
  // Если нет ни того, ни другого — 'unassigned' (серо-голубой фон).
  const seed = hasRealName ? trimmedName : (!isSentinelUid ? uid! : 'unassigned');
  const bgColor = isUnassigned ? UNASSIGNED_BG : getUserColor(seed);

  const initials = hasRealName ? getInitials(trimmedName) : '';
  // Игнорируем photoURL, так как в большинстве случаев это дефолтные
  // плейсхолдеры от Google (просто английская буква на случайном фоне),
  // которые ломают консистентность нашей палитры. При необходимости
  // фичу можно будет вернуть, если добавится функционал ручной загрузки аватаров.
  const showPhoto = false;

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center shrink-0 overflow-hidden font-bold tracking-tight shadow-sm transition-all border border-white/15 text-white',
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: bgColor }}
      title={hasRealName ? trimmedName : 'Не назначен'}
      aria-label={hasRealName ? trimmedName : 'Не назначен'}
    >
      {showPhoto ? (
        <img
          src={photoURL}
          alt={trimmedName || 'Пользователь'}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <UserIcon size={iconSizes[size]} strokeWidth={2.2} className="text-white" />
      )}
    </div>
  );
}
