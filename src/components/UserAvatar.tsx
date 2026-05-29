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

const SENTINEL_UIDS = new Set(['', 'unassigned', 'all', 'system', 'none', 'new']);

// Ярко-розовый — как на карточках проектов и дашборде
const UNASSIGNED_BG = '#9B3F7A';

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

  const isUnassigned = isSentinelUid && !hasRealName;

  const seed = hasRealName ? trimmedName : (!isSentinelUid ? uid! : 'unassigned');
  const bgColor = isUnassigned ? UNASSIGNED_BG : getUserColor(seed);

  const initials = hasRealName ? getInitials(trimmedName) : '';
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
