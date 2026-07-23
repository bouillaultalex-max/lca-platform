/**
 * Bouton d'ouverture du panneau assistant (voir AssistantPanel). Ne gère aucun
 * état lui-même : l'état ouvert/fermé vit dans AppShell, au même niveau que le
 * tiroir mobile de la Sidebar (voir AppShell.tsx) — même convention que le
 * bouton "Ouvrir la navigation" du Header.
 */
export function AssistantButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-white/30 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      🤖 Assistant
    </button>
  );
}
