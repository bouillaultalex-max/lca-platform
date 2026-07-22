import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { USER_ROLE_LABELS } from '@lca-mes/shared';
import { useAuth } from '../../auth/useAuth';

/**
 * Actions réellement existantes uniquement (voir AuthContext) : changer le
 * mot de passe et se déconnecter — reprises à l'identique de l'ancien header
 * d'AppLayout, simplement regroupées dans un menu. Aucune action fictive.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!user) {
    return null;
  }

  const initials = user.fullName
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Menu du compte de ${user.fullName}`}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-white/90 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-xs font-semibold"
        >
          {initials}
        </span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block font-medium">{user.fullName}</span>
          <span className="block text-xs text-white/60">{USER_ROLE_LABELS[user.role]}</span>
        </span>
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={`Menu du compte de ${user.fullName}`}
          className="absolute right-0 z-40 mt-2 w-56 rounded-lg border border-divider bg-white py-1 text-sm text-gray-700 shadow-lg"
        >
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="font-medium text-gray-900">{user.fullName}</p>
            <p className="text-xs text-gray-500">{USER_ROLE_LABELS[user.role]}</p>
          </div>
          <Link
            role="menuitem"
            to="/change-password"
            onClick={() => setIsOpen(false)}
            className="block px-3 py-2 hover:bg-gray-50"
          >
            Changer mon mot de passe
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setIsOpen(false);
              logout();
            }}
            className="block w-full px-3 py-2 text-left text-red-600 hover:bg-gray-50"
          >
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
