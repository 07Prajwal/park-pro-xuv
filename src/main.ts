import './style.css';

async function boot(): Promise<void> {
  const loading = document.getElementById('loading')!;
  const loadingText = document.getElementById('loading-text')!;
  try {
    // Lazy-load the game (and the ~2 MB Rapier WASM) so the first paint is instant.
    const { Game } = await import('./core/Game');
    const game = await Game.create(
      document.getElementById('scene') as HTMLCanvasElement,
      document.getElementById('hud')!,
    );
    game.start();
    loading.classList.add('hidden');
  } catch (err) {
    console.error(err);
    loadingText.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void boot();
