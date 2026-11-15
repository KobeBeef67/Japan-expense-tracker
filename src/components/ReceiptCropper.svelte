<script lang="ts">
  import { onMount } from 'svelte';
  import type { CropRectangle } from '../lib/receipt-images';
  import type { ReceiptOcrMode } from '../lib/receipt-ocr';
  export let src: string;
  export let busy = false;
  export let onapply: (selection: CropRectangle, mode: ReceiptOcrMode) => void;
  export let oncancel: () => void;
  let stage: HTMLDivElement;
  let photo: HTMLImageElement;
  let fit = { left: 0, top: 0, width: 0, height: 0 };
  let left = 10,
    top = 10,
    width = 80,
    height = 80;
  let mode: ReceiptOcrMode = 'receipt';
  let anchor: { x: number; y: number } | null = null;
  let pointerId: number | null = null;
  $: valid =
    [left, top, width, height].every(Number.isFinite) &&
    left >= 0 &&
    top >= 0 &&
    width > 0 &&
    height > 0 &&
    left + width <= 100.00001 &&
    top + height <= 100.00001;
  function measure() {
    if (!photo?.naturalWidth || !stage) return;
    const scale = Math.min(
      stage.clientWidth / photo.naturalWidth,
      stage.clientHeight / photo.naturalHeight,
    );
    const w = photo.naturalWidth * scale,
      h = photo.naturalHeight * scale;
    fit = {
      left: (stage.clientWidth - w) / 2,
      top: (stage.clientHeight - h) / 2,
      width: w,
      height: h,
    };
  }
  function point(event: PointerEvent) {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  }
  function start(event: PointerEvent) {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    anchor = point(event);
    left = anchor.x;
    top = anchor.y;
    width = 0;
    height = 0;
  }
  function move(event: PointerEvent) {
    if (!anchor || pointerId !== event.pointerId) return;
    const end = point(event);
    left = Math.min(anchor.x, end.x);
    top = Math.min(anchor.y, end.y);
    width = Math.abs(end.x - anchor.x);
    height = Math.abs(end.y - anchor.y);
  }
  function end(event: PointerEvent) {
    move(event);
    anchor = null;
    pointerId = null;
  }
  onMount(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
  });
</script>

<div class="crop-layout">
  <div class="crop-stage" bind:this={stage}>
    <img
      bind:this={photo}
      {src}
      alt="Receipt to crop; original stays in memory"
      onload={measure}
      draggable="false"
    />
    {#if fit.width}
      <button
        type="button"
        class="crop-surface"
        aria-label="Drag to select crop area"
        disabled={busy}
        style:left={`${fit.left}px`}
        style:top={`${fit.top}px`}
        style:width={`${fit.width}px`}
        style:height={`${fit.height}px`}
        onpointerdown={start}
        onpointermove={move}
        onpointerup={end}
        onpointercancel={() => {
          anchor = null;
          pointerId = null;
        }}
      >
        <span
          class="selection"
          style:left={`${left}%`}
          style:top={`${top}%`}
          style:width={`${width}%`}
          style:height={`${height}%`}
        ></span>
      </button>
    {/if}
  </div>
  <fieldset disabled={busy}>
    <legend>Crop selected photo</legend>
    <p>
      Drag a box around the text you want to read. Leave a little space around it. You can also
      enter percentages below.
    </p>
    <div class="coordinates">
      <label>Left (%)<input type="number" min="0" max="100" step="any" bind:value={left} /></label>
      <label>Top (%)<input type="number" min="0" max="100" step="any" bind:value={top} /></label>
      <label
        >Width (%)<input type="number" min="0.1" max="100" step="any" bind:value={width} /></label
      >
      <label
        >Height (%)<input type="number" min="0.1" max="100" step="any" bind:value={height} /></label
      >
    </div>
    <label
      >Crop contains<select aria-label="Crop contains" bind:value={mode}>
        <option value="receipt">Receipt text / date (Japanese + English)</option>
        <option value="amount">Amount only (one line)</option>
      </select></label
    >
    <p>
      Amount only uses separate English recognition. A single unique candidate fills the amount
      automatically. Check it during review; conflicting amounts require your selection.
    </p>
    {#if !valid}<p role="status">Select a non-empty area inside the photo.</p>{/if}
    <button
      type="button"
      disabled={!valid || busy}
      onclick={() =>
        onapply(
          { left: left / 100, top: top / 100, width: width / 100, height: height / 100 },
          mode,
        )}>{busy ? 'Cropping…' : 'Apply crop'}</button
    >
    <button type="button" disabled={busy} onclick={oncancel}>Cancel crop</button>
  </fieldset>
</div>

<style>
  .crop-layout {
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(260px, 1fr);
    gap: 16px;
    align-items: start;
  }
  .crop-stage {
    position: relative;
    height: 48vh;
    overflow: hidden;
    background: #17241b;
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .crop-stage .crop-surface,
  .crop-stage .crop-surface:hover:not(:disabled) {
    position: absolute;
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0;
    touch-action: none;
    cursor: crosshair;
    overflow: hidden;
  }
  .selection {
    position: absolute;
    border: 2px solid #fff88c;
    box-shadow: 0 0 0 9999px #0008;
    box-sizing: border-box;
    pointer-events: none;
  }
  fieldset {
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .coordinates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  label {
    display: grid;
    gap: 4px;
    margin: 8px 0;
    font-size: 12px;
  }
  input {
    width: 100%;
  }
  p {
    font-size: 12px;
  }
  button {
    margin: 5px 5px 0 0;
  }
  @media (max-width: 850px) {
    .crop-layout {
      grid-template-columns: 1fr;
    }
    .crop-stage {
      height: 32vh;
    }
  }
</style>
