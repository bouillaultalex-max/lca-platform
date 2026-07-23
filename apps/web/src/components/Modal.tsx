import type { ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  widthClassName = 'max-w-md',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Largeur du modal (classe Tailwind `max-w-*`) ; par défaut identique à avant. */
  widthClassName?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={`w-full ${widthClassName} rounded-lg bg-white p-6 shadow-lg`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="text-gray-400 transition hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
