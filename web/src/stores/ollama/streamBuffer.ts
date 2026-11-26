// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Streamed chunks are buffered and applied once per frame instead of once per token.
export function createChunkBuffer(apply: (content: string, thinking: string) => void) {
  let pendingContent = "";
  let pendingThinking = "";
  let flushHandle: number | null = null;

  // Apply any buffered chunks now. Call before every non-chunk event to keep ordering.
  function flush() {
    if (flushHandle !== null) {
      cancelAnimationFrame(flushHandle);
      flushHandle = null;
    }
    if (!pendingContent && !pendingThinking) return;
    const content = pendingContent;
    const thinking = pendingThinking;
    pendingContent = "";
    pendingThinking = "";
    apply(content, thinking);
  }

  // Buffer a chunk and apply it on the next animation frame.
  function queue(content: string, thinking: string) {
    pendingContent += content;
    pendingThinking += thinking;
    if (flushHandle === null) flushHandle = requestAnimationFrame(flush);
  }

  // Drop everything that is buffered without applying it (logout).
  function reset() {
    if (flushHandle !== null) cancelAnimationFrame(flushHandle);
    flushHandle = null;
    pendingContent = "";
    pendingThinking = "";
  }

  return { queue, flush, reset };
}
