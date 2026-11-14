import './style.css';

async function boot(): Promise<void> {
  const loading = document.getElementById('loading')!;
  const loadingText = document.getElementById('loading-text')!;
  try {
    // Lazy-load the game (and the Rapier WASM) so the first paint is instant.
    const { Game } = await import('./core/Game');
    loadingText.textContent = 'Loading textures…';
    const game = await Game.create(
      document.getElementById('scene') as HTMLCanvasElement,
      document.getElementById('hud')!,
      (f) => (loadingText.textContent = `Loading textures… ${Math.round(f * 100)}%`),
    );
    game.start();
    loading.classList.add('hidden');
  } catch (err) {
    console.error(err);
    loadingText.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  }
}

void boot();
