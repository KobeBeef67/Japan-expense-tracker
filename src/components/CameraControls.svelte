<script lang="ts">
  import {
    cameraCapabilities,
    cameraSettings,
    adjustableRange,
    applyCameraSetting,
  } from '../lib/camera-controls';
  import type { CameraSettings } from '../lib/camera-controls';
  export let track: MediaStreamTrack;
  export let onchange: (busy: boolean) => void = () => {};
  $: capabilities = cameraCapabilities(track);
  let settings: CameraSettings = {};
  $: if (track) settings = cameraSettings(track);
  let busy = false;
  let message = '';
  const ranges = [
    ['focusDistance', 'Manual focus distance'],
    ['exposureCompensation', 'Exposure compensation'],
    ['brightness', 'Brightness'],
    ['zoom', 'Zoom'],
  ] as const;
  async function change(values: CameraSettings) {
    busy = true;
    onchange(true);
    try {
      const confirmed = await applyCameraSetting(track, values);
      settings = cameraSettings(track);
      message = confirmed
        ? 'Camera confirmed the setting. Check sharpness in the preview.'
        : 'Setting requested, but the camera did not confirm it. Check the preview.';
    } catch (error) {
      settings = cameraSettings(track);
      message = `Camera could not apply this setting: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      onchange(false);
    }
  }
</script>

<fieldset disabled={busy}>
  <legend>Camera controls</legend>
  {#each [['focusMode', 'Focus mode'], ['exposureMode', 'Exposure mode']] as [key, label]}
    {@const property = key as 'focusMode' | 'exposureMode'}
    {@const modes = capabilities[property] || []}
    {#if modes.length && modes.some((mode) => mode !== 'none')}
      <label
        >{label}<select
          aria-label={label}
          value={settings[property] || ''}
          onchange={(event) => change({ [property]: event.currentTarget.value })}
        >
          {#if !settings[property]}<option value="" disabled>Choose mode</option>{/if}
          {#each modes as mode}<option value={mode}>{mode}</option>{/each}
        </select></label
      >
      {#if property === 'focusMode' && modes.includes('single-shot')}
        <button type="button" onclick={() => change({ focusMode: 'single-shot' })}
          >Refocus once</button
        >
      {/if}
    {:else}<small>{label}: unavailable from this camera.</small>{/if}
  {/each}
  {#each ranges as [key, label]}
    {@const range = capabilities[key]}
    {#if adjustableRange(range) && (key !== 'focusDistance' || capabilities.focusMode?.includes('manual'))}
      <label
        >{label}: {settings[key] ?? 'not reported'}
        <input
          type="range"
          aria-label={`${label}: ${settings[key] ?? 'not reported'}`}
          min={range.min}
          max={range.max}
          step={range.step || (range.max - range.min) / 100}
          value={settings[key] ?? range.min}
          disabled={key === 'focusDistance' && settings.focusMode !== 'manual'}
          onchange={(event) => change({ [key]: Number(event.currentTarget.value) })}
        />
      </label>
    {/if}
  {/each}
  {#if !adjustableRange(capabilities.focusDistance)}<small
      >Manual focus distance: unavailable from this camera.</small
    >{/if}
  {#if message}<p role="status">{message}</p>{/if}
</fieldset>

<style>
  fieldset {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 12px 0;
    border: 1px solid #bdcbb7;
    border-radius: 6px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
  }
  small {
    align-self: center;
  }
  p {
    width: 100%;
    margin: 0;
    font-size: 12px;
  }
</style>
