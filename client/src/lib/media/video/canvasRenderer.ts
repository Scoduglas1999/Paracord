// Video frame rendering to HTMLCanvasElement.
// Efficiently renders VideoFrame objects using requestAnimationFrame
// and handles dynamic resolution changes from simulcast layer switching.

/**
 * Renders decoded VideoFrame objects onto an HTML canvas.
 *
 * Uses requestAnimationFrame for efficient rendering, automatically
 * adapts the canvas size to match incoming frame resolution, and
 * properly closes frames after drawing to prevent memory leaks.
 */
export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pendingFrame: VideoFrame | null = null;
  private rafId: number | null = null;
  private destroyed = false;

  /** Tracks the current frame resolution for detecting layer switches. */
  private currentWidth = 0;
  private currentHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const ctx = canvas.getContext('2d', {
      // Hint for better performance: we replace the entire canvas each frame.
      alpha: false,
      desynchronized: true,
    });
    if (!ctx) {
      throw new Error('Failed to get 2d rendering context from canvas');
    }
    this.ctx = ctx;

    // Start the render loop.
    this.scheduleRender();
  }

  /**
   * Submit a VideoFrame for rendering.
   *
   * Only the most recent frame is kept. If a new frame arrives before
   * the previous one is drawn, the old frame is closed (freed) and
   * replaced. This ensures we always display the latest frame and
   * never accumulate a backlog.
   *
   * Ownership of the frame transfers to the renderer. The caller
   * must not close the frame after calling this method.
   */
  renderFrame(frame: VideoFrame): void {
    if (this.destroyed) {
      frame.close();
      return;
    }

    // Close the previously pending frame if it was not yet rendered.
    if (this.pendingFrame) {
      this.pendingFrame.close();
    }

    this.pendingFrame = frame;
  }

  /**
   * Clear the canvas to black and discard any pending frame.
   */
  clear(): void {
    if (this.pendingFrame) {
      this.pendingFrame.close();
      this.pendingFrame = null;
    }

    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Destroy the renderer, stopping the render loop and releasing resources.
   * After calling destroy(), the renderer cannot be reused.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.pendingFrame) {
      this.pendingFrame.close();
      this.pendingFrame = null;
    }

    // Clear to black on teardown.
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Whether the renderer has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** Current displayed frame resolution (width). */
  get frameWidth(): number {
    return this.currentWidth;
  }

  /** Current displayed frame resolution (height). */
  get frameHeight(): number {
    return this.currentHeight;
  }

  private scheduleRender(): void {
    if (this.destroyed) return;

    this.rafId = requestAnimationFrame(() => {
      this.drawFrame();
      this.scheduleRender();
    });
  }

  private drawFrame(): void {
    if (!this.pendingFrame) return;

    const frame = this.pendingFrame;
    this.pendingFrame = null;

    try {
      const frameWidth = frame.displayWidth;
      const frameHeight = frame.displayHeight;

      // If the incoming frame resolution changed (simulcast layer switch),
      // update the canvas dimensions to match.
      if (frameWidth !== this.currentWidth || frameHeight !== this.currentHeight) {
        this.currentWidth = frameWidth;
        this.currentHeight = frameHeight;
        this.canvas.width = frameWidth;
        this.canvas.height = frameHeight;
      }

      // Draw the VideoFrame onto the canvas.
      // The drawImage API accepts VideoFrame directly.
      this.ctx.drawImage(frame, 0, 0, frameWidth, frameHeight);
    } finally {
      // Always close the frame to release GPU/memory resources.
      frame.close();
    }
  }
}
