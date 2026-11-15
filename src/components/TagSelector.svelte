<script lang="ts">
  import type { Tag } from '../lib/model';
  import { cleanTagName, tagKey } from '../lib/tag-names';
  export let tags: Tag[] = [];
  export let names: string[] = [];
  export let label = 'Tags';
  export let disabled = false;
  export let allowCreate = true;
  let input = '',
    error = '';
  $: suggestions = tags
    .filter(
      (t) =>
        !names.some((n) => tagKey(n) === tagKey(t.name)) &&
        (!input || tagKey(t.name).includes(tagKey(input))),
    )
    .slice(0, 10);
  function add(value: string) {
    try {
      const name = cleanTagName(value);
      const existing = tags.find((t) => tagKey(t.name) === tagKey(name));
      if (!allowCreate && !existing) throw new Error('Choose an existing tag');
      if (!names.some((n) => tagKey(n) === tagKey(name)))
        names = [...names, existing?.name || name];
      input = '';
      error = '';
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      e.stopPropagation();
      add(input);
    }
    if (e.key === 'Escape') input = '';
  }
</script>

<div class="tag-selector">
  <label
    >{label}
    <div class="box">
      <div class="chips">
        {#each names as name}<button
            type="button"
            {disabled}
            aria-label={`Remove tag ${name} from selection`}
            onclick={() => (names = names.filter((n) => tagKey(n) !== tagKey(name)))}
            >{name} ×</button
          >{/each}
      </div>
      <input
        aria-label={label}
        {disabled}
        bind:value={input}
        onkeydown={key}
        placeholder="Type a tag; Enter to add"
        maxlength="120"
      /><button type="button" {disabled} onclick={() => add(input)}>Add</button>
    </div></label
  >
  {#if input || !names.length}<div class="suggestions">
      {#each suggestions as tag}<button type="button" {disabled} onclick={() => add(tag.name)}
          >{tag.name}</button
        >{/each}
    </div>{/if}
  {#if error}<small class="tag-error" role="alert">{error}</small>{/if}
  <small>Multiple tags allowed. Tags stay separate from review flags.</small>
</div>

<style>
  .tag-selector {
    margin: 10px 0;
  }
  .box {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 5px;
    background: var(--surface);
    flex-wrap: wrap;
  }
  .box input {
    border: 0;
    flex: 1;
    min-width: 120px;
    font-size: 11px;
    padding: 6px;
  }
  .box > button {
    padding: 4px 8px;
    font-size: 11px;
  }
  .chips {
    display: contents;
  }
  .chips button {
    border: 0;
    background: var(--selected);
    border-radius: 5px;
    padding: 4px 7px;
    font-size: 11px;
  }
  .suggestions {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    margin: 5px 0;
  }
  .suggestions button {
    font-size: 10px;
    padding: 3px 6px;
  }
  .tag-error {
    color: var(--danger-text);
  }
  small {
    font-size: 10px;
    color: var(--subtle);
  }
</style>
