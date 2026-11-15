<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { emptyLedger, totals, categorySuggestion, recurringSuggestions } from './lib/model';
  import type { Ledger, Transaction, Kind, ImportReport } from './lib/model';
  import { inspectWorkbook, planImport } from './lib/importer';
  import { yen, calculate } from './lib/arithmetic';
  import ReceiptScanner from './components/ReceiptScanner.svelte';
  import type { ReceiptDraft } from './lib/receipts';
  import TagSelector from './components/TagSelector.svelte';
  import {
    tagNames,
    resolveTagNames,
    matchesTags,
    tagSpending,
    bulkTags,
    renameTag,
    removeTag,
    ensureTag,
  } from './lib/tags';
  import { tagKey } from './lib/tag-names';
  import { csvText as exportRows } from './lib/csv';
  import { applyTheme, themePreference } from './lib/theme';

  // Screen, entry form, and dialog state. Nothing here writes to disk on its own.
  let scannerOpen = false;
  const native = !!(window as any).__TAURI_INTERNALS__;
  const localDay = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  let ledger: Ledger = emptyLedger(),
    loaded = false,
    busy = false,
    error = '',
    status = '',
    path = '',
    recovery = '';
  let view: 'month' | 'history' | 'tags' | 'import' | 'backups' = 'month';
  let month = localDay().slice(0, 7),
    search = '',
    kind = '',
    categoryFilter = '',
    flagged = false;
  let date = localDay(),
    description = '',
    amount = '',
    type: Kind = 'expense',
    category = '',
    entryTags: string[] = [],
    notes = '',
    entryMonth = month,
    editingId: string | null = null;
  let filterTags: string[] = [],
    tagMode: 'any' | 'all' = 'any',
    selectedIds: string[] = [],
    bulkNames: string[] = [],
    tagIdToManage = '',
    renameName = '',
    newTagName = '',
    confirmTagRemoval = false,
    mergeTagsConfirmed = false;
  let dateInput: HTMLInputElement, descriptionInput: HTMLInputElement, fileInput: HTMLInputElement;
  let undoStack: Ledger[] = [];
  let pending: { transactions: Transaction[]; report: ImportReport } | null = null;
  let previewSearch = '',
    previewFilter = 'flagged';
  let backupNames: string[] = [],
    restoreName = '',
    confirmRestore = false;
  let settings: any = {
    schemaVersion: 1,
    currency: 'JPY',
    rounding: 'half-away-from-zero',
    theme: 'light',
    categories: [
      'Food',
      'Housing',
      'Transport',
      'Bills',
      'Shopping',
      'Entertainment',
      'Travel',
      'Health',
    ],
  };
  let settingsOpen = false,
    categoryText = '';
  let settingsSaving = false;

  // Derived views: recomputed from the committed ledger when state changes.
  $: monthItems = ledger.transactions.filter((t) => t.month === month);
  $: summary = totals(monthItems);
  $: accumulated = totals(ledger.transactions.filter((t) => t.month <= month));
  $: months = [...new Set([month, ...ledger.transactions.map((t) => t.month)])].sort().reverse();
  $: descriptions = [...new Set(ledger.transactions.map((t) => t.description))].sort();
  $: categories = [
    ...new Set([
      ...settings.categories,
      ...ledger.transactions.map((t) => t.category).filter(Boolean),
    ]),
  ].sort();
  $: filterTagIds = ledger.tags
    .filter((t) => filterTags.some((n) => tagKey(n) === tagKey(t.name)))
    .map((t) => t.id);
  $: filtered = (view === 'month' ? monthItems : ledger.transactions)
    .filter(
      (t) =>
        (!search ||
          `${t.description} ${t.notes} ${t.source?.cell || ''}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!kind || t.type === kind) &&
        (!categoryFilter || t.category === categoryFilter) &&
        matchesTags(t, filterTagIds, tagMode) &&
        (!flagged || t.flags.length || t.amount === null),
    )
    .sort((a, b) => b.month.localeCompare(a.month) || (b.date || '').localeCompare(a.date || ''));
  $: filteredTotals = totals(filtered);
  $: spending = tagSpending(filtered);
  $: managedTag = ledger.tags.find((t) => t.id === tagIdToManage);
  $: renameCollision = ledger.tags.find(
    (t) => t.id !== tagIdToManage && tagKey(t.name) === tagKey(renameName),
  );
  $: suggestions = recurringSuggestions(ledger.transactions, month);
  $: suggestion = categorySuggestion(description);
  $: importPlan = pending ? planImport(ledger, pending.transactions) : null;
  $: previewRows =
    pending?.transactions.filter(
      (t) =>
        (previewFilter === 'all' ||
          (previewFilter === 'missing'
            ? t.amount === null
            : previewFilter === 'year'
              ? t.flags.includes('Likely year error')
              : t.flags.length > 0)) &&
        `${t.description} ${t.source?.cell}`.toLowerCase().includes(previewSearch.toLowerCase()),
    ) || [];
  $: amountPreview = (() => {
    try {
      return amount ? `¥${formatNumber(yen(amount))}` : '';
    } catch {
      return 'Use numbers and + − * / ( )';
    }
  })();
  const formatNumber = (v: number) => v.toLocaleString('en-US');
  const formatYen = (v: number) => `${v < 0 ? '−' : ''}¥${formatNumber(Math.abs(v))}`;

  // All ledger mutations pass through this boundary; publish UI state only after save succeeds.
  async function commitLedger(next: Ledger, message: string, remember = true) {
    if (busy) throw new Error('Another save is in progress');
    busy = true;
    error = '';
    const before = structuredClone(ledger);
    try {
      const saved = native
        ? await invoke<Ledger>('save', { ledger: next, expected: ledger.revision })
        : { ...next, revision: ledger.revision + 1 };
      if (remember) {
        undoStack = [...undoStack.slice(-29), before];
      }
      ledger = saved;
      selectedIds = selectedIds.filter((id) => saved.transactions.some((t) => t.id === id));
      filterTags = filterTags.filter((n) => saved.tags.some((t) => tagKey(t.name) === tagKey(n)));
      status = message + ' · Saved';
    } catch (e) {
      error = String(e);
      throw e;
    } finally {
      busy = false;
    }
  }
  async function undo() {
    if (!undoStack.length || busy) return;
    const old = undoStack.at(-1)!;
    try {
      await commitLedger({ ...structuredClone(old), revision: ledger.revision }, 'Undone', false);
      undoStack = undoStack.slice(0, -1);
    } catch {}
  }
  function clearEntry() {
    editingId = null;
    description = '';
    amount = '';
    category = '';
    entryTags = [];
    notes = '';
    type = 'expense';
    entryMonth = month;
    date = month === localDay().slice(0, 7) ? localDay() : '';
  }

  // Manual-entry validation preserves null dates/amounts and immutable import provenance.
  async function saveManualEntry() {
    if (!loaded || busy) return;
    error = '';
    try {
      if (!description.trim()) throw new Error('Enter a description');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(entryMonth)) throw new Error('Choose a reporting month');
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)
      )
        throw new Error('Enter a valid date or leave it blank');
      const raw = amount.trim() ? calculate(amount) : null;
      let k = type;
      if (raw?.isNegative() && type === 'expense') k = 'income';
      if (raw?.isNegative() && type !== 'expense')
        throw new Error('Use a positive amount for the selected income type');
      const previous = editingId ? ledger.transactions.find((t) => t.id === editingId) : undefined;
      let flags = (previous?.flags || []).filter(
        (f) =>
          ![
            'Missing amount',
            'Undated',
            'Likely year error',
            'Date outside reporting month',
            'Rounded to whole yen',
          ].includes(f),
      );
      if (raw === null) flags.push('Missing amount');
      if (!date) flags.push('Undated');
      if (date && date.slice(0, 7) !== entryMonth) flags.push('Date outside reporting month');
      if (raw && !raw.isInteger()) flags.push('Rounded to whole yen');
      const resolved = resolveTagNames(structuredClone(ledger), entryTags);
      const t: Transaction = {
        ...previous,
        id: editingId || crypto.randomUUID(),
        date: date || null,
        month: entryMonth,
        description: description.trim(),
        amount: raw === null ? null : Math.abs(yen(amount)),
        type: k,
        category,
        tagIds: resolved.ids,
        notes,
        flags,
        expression: amount,
      };
      const next = resolved.ledger;
      if (editingId) next.transactions = next.transactions.map((x) => (x.id === editingId ? t : x));
      else next.transactions.push(t);
      await commitLedger(next, editingId ? 'Entry updated' : 'Entry added');
      clearEntry();
      descriptionInput?.focus();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }
  // Receipt review uses the same revision-checked save path as manual entry.
  async function saveReceipt(d: ReceiptDraft) {
    if (busy) throw new Error('Another save is in progress. Wait and retry.');
    const resolved = resolveTagNames(structuredClone(ledger), d.tagNames),
      flags: string[] = [];
    if (d.amount === null) flags.push('Missing amount');
    if (!d.date) flags.push('Undated');
    if (d.date && d.date.slice(0, 7) !== d.month) flags.push('Date outside reporting month');
    const t: Transaction = {
      id: crypto.randomUUID(),
      date: d.date,
      month: d.month,
      description: d.description,
      amount: d.amount,
      type: d.type,
      category: d.category,
      tagIds: resolved.ids,
      notes: '',
      flags,
      expression: d.expression,
      receipt: {
        origin: 'receipt-scan',
        input: d.via,
        engine: 'tesseract.js-6.0.1',
        reviewedAt: new Date().toISOString(),
      },
    };
    resolved.ledger.transactions.push(t);
    await commitLedger(resolved.ledger, 'Reviewed receipt saved');
    month = d.month;
    view = 'month';
  }

  function edit(t: Transaction) {
    if (view === 'tags') view = 'history';
    editingId = t.id;
    date = t.date || '';
    entryMonth = t.month;
    description = t.description;
    amount = t.amount === null ? '' : String(t.amount);
    type = t.type;
    category = t.category;
    entryTags = tagNames(ledger.tags, t.tagIds);
    notes = t.notes;
    descriptionInput?.focus();
  }
  function duplicate(t?: Transaction) {
    const last = t || ledger.transactions.at(-1);
    if (!last) return;
    edit(last);
    editingId = null;
    date = month === localDay().slice(0, 7) ? localDay() : '';
    entryMonth = month;
    status = 'Duplicated into the entry form. Press Enter to save.';
  }
  async function remove(t: Transaction) {
    const next = structuredClone(ledger);
    next.transactions = next.transactions.filter((x) => x.id !== t.id);
    if (t.source && !next.deletedSourceIds.includes(t.id)) next.deletedSourceIds.push(t.id);
    try {
      await commitLedger(next, 'Entry deleted — Undo is available');
      if (editingId === t.id) clearEntry();
    } catch {}
  }

  // Workbook preview is read-only. importNow is the separate confirmation step.
  async function inspect(bytes: Uint8Array, name: string) {
    busy = true;
    error = '';
    status = 'Reading workbook…';
    try {
      pending = await inspectWorkbook(bytes, name);
      view = 'import';
      status = 'Preview ready. Nothing imported yet.';
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
  async function pickFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) await inspect(new Uint8Array(await file.arrayBuffer()), file.name);
    (e.target as HTMLInputElement).value = '';
  }
  async function bundled() {
    try {
      const r = await fetch('/Japan%20expenses.xlsx');
      if (!r.ok) throw new Error('Bundled workbook unavailable');
      await inspect(new Uint8Array(await r.arrayBuffer()), 'Japan expenses.xlsx');
    } catch (e) {
      error = String(e);
    }
  }
  async function importNow() {
    if (!pending || !importPlan) return;
    const next = structuredClone(ledger);
    next.transactions.push(...importPlan.fresh);
    if (!next.imports.some((r) => r.hash === pending!.report.hash))
      next.imports.push(pending.report);
    try {
      await commitLedger(
        next,
        `Imported ${importPlan.fresh.length} entries; skipped ${importPlan.skipped.length}`,
      );
      month = pending.report.months.at(-1)!.month;
      entryMonth = month;
      date = '';
    } catch {}
  }
  async function listBackups() {
    view = 'backups';
    try {
      backupNames = native ? await invoke<string[]>('backups') : [];
    } catch (e) {
      error = String(e);
    }
  }
  async function makeBackup() {
    try {
      if (native) await invoke('backup');
      status = 'Backup created';
      await listBackups();
    } catch (e) {
      error = String(e);
    }
  }
  async function restoreBackup() {
    if (!restoreName || busy) return;
    busy = true;
    error = '';
    try {
      const before = structuredClone(ledger);
      ledger = await invoke<Ledger>('restore', { name: restoreName });
      undoStack = [...undoStack, before];
      confirmRestore = false;
      status = 'Backup restored. A backup of the previous data was created.';
      await listBackups();
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }
  function csvText() {
    return exportRows(filtered, ledger.tags);
  }

  // Tag changes produce a complete next ledger and commit once, including bulk operations.
  function toggleSelected(id: string) {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((s) => s !== id)
      : [...selectedIds, id];
  }
  function selectTag(id: string) {
    const t = ledger.tags.find((t) => t.id === id);
    if (!t) return;
    view = 'tags';
    filterTags = [t.name];
    tagIdToManage = id;
    renameName = t.name;
    search = '';
    kind = '';
    categoryFilter = '';
    flagged = false;
    confirmTagRemoval = false;
    mergeTagsConfirmed = false;
  }
  async function applyBulk(operation: 'add' | 'remove') {
    if (busy) return;
    try {
      if (!selectedIds.length || !bulkNames.length)
        throw new Error('Select transactions and at least one tag');
      let next = structuredClone(ledger);
      let ids: string[];
      if (operation === 'add') {
        const result = resolveTagNames(next, bulkNames);
        next = result.ledger;
        ids = result.ids;
      } else {
        ids = next.tags
          .filter((t) => bulkNames.some((n) => tagKey(n) === tagKey(t.name)))
          .map((t) => t.id);
        if (ids.length !== bulkNames.length) throw new Error('Only existing tags can be removed');
      }
      await commitLedger(
        bulkTags(next, selectedIds, ids, operation),
        `${operation === 'add' ? 'Added' : 'Removed'} tags for ${selectedIds.length} selected entries`,
      );
      bulkNames = [];
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }
  async function createTag() {
    if (busy) return;
    try {
      await commitLedger(ensureTag(structuredClone(ledger), newTagName).ledger, 'Tag created');
      newTagName = '';
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }
  async function saveTagRename() {
    if (busy) return;
    try {
      const target = renameCollision?.id;
      await commitLedger(
        renameTag(structuredClone(ledger), tagIdToManage, renameName, mergeTagsConfirmed),
        'Tag renamed / merged',
      );
      if (target) selectTag(target);
      else selectTag(tagIdToManage);
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }
  async function deleteTag() {
    if (busy) return;
    try {
      await commitLedger(
        removeTag(structuredClone(ledger), tagIdToManage),
        'Tag removed; transactions preserved',
      );
      tagIdToManage = '';
      renameName = '';
      confirmTagRemoval = false;
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    }
  }

  // Export/settings actions do not alter transaction accounting.
  async function exportCsv() {
    try {
      if (native) {
        status = 'Exported to ' + (await invoke<string>('export_csv', { csv: csvText() }));
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv' }));
        a.download = 'expenses.csv';
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) {
      error = String(e);
    }
  }
  async function persistSettings(next: typeof settings, message: string) {
    if (settingsSaving) return false;
    settingsSaving = true;
    error = '';
    try {
      if (native) await invoke('save_settings', { settings: next });
      settings = next;
      applyTheme(themePreference(settings.theme));
      status = message;
      return true;
    } catch (failure) {
      error = String(failure);
      return false;
    } finally {
      settingsSaving = false;
    }
  }
  async function changeTheme() {
    const theme = themePreference(settings.theme) === 'dark' ? 'light' : 'dark';
    await persistSettings({ ...settings, theme }, 'Theme saved');
  }
  async function saveCategories() {
    if (settingsSaving) return;
    try {
      const next = {
        ...settings,
        categories: [
          ...new Set(
            categoryText
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ],
      };
      if (await persistSettings(next, 'Categories saved')) settingsOpen = false;
    } catch (e) {
      error = String(e);
    }
  }

  // Global shortcuts defer to the scanner while its modal is open.
  function keys(e: KeyboardEvent) {
    if (scannerOpen) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      if (!busy) duplicate();
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key === 'z' &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    ) {
      e.preventDefault();
      void undo();
    }
    if (e.key === 'Escape') clearEntry();
    if (e.altKey && e.key === 'n') {
      e.preventDefault();
      dateInput?.focus();
    }
  }

  // Startup loads native state. Browser preview intentionally keeps changes only in memory.
  onMount(async () => {
    try {
      if (native) {
        const data = await invoke<any>('load');
        ledger = data.ledger;
        path = data.path;
        recovery = data.recovery;
        settings = { ...data.settings, theme: themePreference(data.settings.theme) };
        applyTheme(themePreference(settings.theme));
        if (data.ocrSelfTest) {
          try {
            const { ocrSelfTest } = await import('./lib/ocr-self-test');
            await invoke('finish_ocr_self_test', { result: await ocrSelfTest() });
          } catch (e) {
            await invoke('finish_ocr_self_test', { result: { passed: false, error: String(e) } });
          }
          return;
        }
      } else {
        status = 'Browser preview · changes last only in this tab';
      }
      loaded = true;
    } catch (e) {
      error = String(e);
    }
  });
</script>

<svelte:window onkeydown={keys} />
<div class="shell">
  <aside>
    <div class="brand">
      <span class="mark">¥</span>
      <div>Expense Tracker<small>LOCAL · JAPAN</small></div>
    </div>
    <nav aria-label="Main navigation">
      <button class:active={view === 'month'} onclick={() => (view = 'month')}
        >▦ &nbsp; Monthly ledger</button
      ><button class:active={view === 'history'} onclick={() => (view = 'history')}
        >⌕ &nbsp; All history</button
      ><button class:active={view === 'tags'} onclick={() => (view = 'tags')}
        >◇ &nbsp; Tags & collections</button
      ><button class:active={view === 'import'} onclick={() => (view = 'import')}
        >↓ &nbsp; Import & reconcile</button
      ><button class:active={view === 'backups'} onclick={listBackups}
        >↺ &nbsp; Backups & restore</button
      >
    </nav>
    <div class="side-month">
      <label for="month">Reporting month</label><input
        id="month"
        type="month"
        bind:value={month}
        onchange={() => {
          entryMonth = month;
          date = month === localDay().slice(0, 7) ? localDay() : '';
        }}
      />
      <div class="month-list">
        {#each months.slice(0, 30) as m}<button
            class:chosen={m === month}
            onclick={() => {
              month = m;
              entryMonth = m;
              date = '';
            }}
            >{new Date(m + '-01T00:00:00').toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
            })}<span>{ledger.transactions.filter((t) => t.month === m).length}</span></button
          >{/each}
      </div>
    </div>
    <div class="side-bottom">
      <span class="dot"></span> Offline · JSON storage<button
        onclick={() => {
          categoryText = settings.categories.join(', ');
          settingsOpen = true;
        }}>Edit categories</button
      ><small title={path}>{path || 'Portable folder / data'}</small>
    </div>
  </aside>
  <main>
    <header>
      <div>
        <p class="eyebrow">YOUR MONEY, AT A GLANCE</p>
        <h1>
          {view === 'month'
            ? new Date(month + '-01T00:00:00').toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
              })
            : view === 'history'
              ? 'All history'
              : view === 'tags'
                ? 'Tags & collections'
                : view === 'import'
                  ? 'Import & reconciliation'
                  : 'Backups & restore'}
        </h1>
      </div>
      <div class="header-actions">
        <button
          class="theme-toggle"
          type="button"
          role="switch"
          aria-label="Dark mode"
          aria-checked={themePreference(settings.theme) === 'dark'}
          disabled={!loaded || settingsSaving}
          onclick={changeTheme}
          ><span class="switch-track" aria-hidden="true"></span>Dark mode</button
        >
        <span class="save-status"
          >{busy ? 'Working…' : loaded ? '● Saved locally' : 'Opening…'}</span
        ><button disabled={!undoStack.length || busy} onclick={undo}>Undo <kbd>Ctrl Z</kbd></button>
      </div>
    </header>
    {#if !native}<div class="notice">
        Browser preview. Use the Windows app for persistent files and backups.
      </div>{/if}
    {#if recovery}<div class="notice">
        {recovery}<button onclick={() => (recovery = '')}>Dismiss</button>
      </div>{/if}
    {#if error}<div class="error" role="alert">
        {error}<button onclick={() => (error = '')}>Dismiss</button>
      </div>{/if}
    {#if settingsOpen}<section class="card">
        <h2>Editable categories</h2>
        <label
          >Separate categories with commas<input class="wide" bind:value={categoryText} /></label
        >
        <p>
          Suggestions are optional. Ambiguous descriptions such as “amazon” have no automatic
          category.
        </p>
        <button disabled={settingsSaving} onclick={saveCategories}>Save categories</button><button
          onclick={() => (settingsOpen = false)}>Cancel</button
        >
      </section>{/if}
    {#if view === 'month' || view === 'history' || view === 'tags'}
      {#if view === 'tags'}
        <section class="card tag-manager">
          <h2>Available tags</h2>
          <div class="tag-list">
            {#each ledger.tags as tag}<button
                class:primary={tagIdToManage === tag.id}
                onclick={() => selectTag(tag.id)}
                >{tag.name}
                <span class="count"
                  >{ledger.transactions.filter((t) => t.tagIds.includes(tag.id)).length}</span
                ></button
              >{/each}{#if !ledger.tags.length}<p>
                No tags yet. Add tags below or while entering/editingId an expense.
              </p>{/if}
          </div>
          <div class="tag-create">
            <input
              aria-label="New tag name"
              bind:value={newTagName}
              placeholder="New tag name"
              maxlength="120"
            /><button disabled={busy || !loaded} onclick={createTag}>Create tag</button><button
              onclick={() => {
                filterTags = [];
                tagIdToManage = '';
              }}>Show all transactions</button
            >
          </div>
          {#if managedTag}<div class="manage">
              <h3>Manage “{managedTag.name}”</h3>
              <label>Rename tag<input bind:value={renameName} maxlength="120" /></label
              >{#if renameCollision}<label class="check"
                  ><input type="checkbox" bind:checked={mergeTagsConfirmed} />Merge membership into
                  “{renameCollision.name}” without duplicates</label
                >{/if}<button
                disabled={busy || (!!renameCollision && !mergeTagsConfirmed)}
                onclick={saveTagRename}>{renameCollision ? 'Merge tags' : 'Rename tag'}</button
              ><button disabled={busy} onclick={() => (confirmTagRemoval = true)}
                >Remove tag…</button
              >{#if confirmTagRemoval}<div class="notice">
                  Remove this tag and its associations? Transactions and amounts remain intact.<button
                    disabled={busy}
                    onclick={deleteTag}>Remove tag</button
                  ><button onclick={() => (confirmTagRemoval = false)}>Cancel</button>
                </div>{/if}
            </div>{/if}
        </section>
        <section class="stats">
          <div><span>Expenses</span><strong>{formatYen(spending.expenses)}</strong></div>
          <div>
            <span>Refunds / reimbursements</span><strong>{formatYen(spending.refunds)}</strong>
          </div>
          <div class="highlight">
            <span>Net spending · expenses − refunds</span><strong
              >{formatYen(spending.netSpending)}</strong
            >
          </div>
          <div>
            <span>Other income / salary</span><strong
              >{formatYen(spending.income + spending.salary)}</strong
            ><small>Income {formatYen(spending.income)} · salary {formatYen(spending.salary)}</small
            >
          </div>
        </section>
        <p>
          {filtered.length} matching entries · {spending.unresolved} unresolved amounts excluded{spending.unresolved
            ? ' — totals are incomplete'
            : ''}. Each matching transaction counts once.
        </p>
      {:else}
        <section class="stats">
          <div><span>Salary</span><strong>{formatYen(summary.salary)}</strong></div>
          <div><span>Expenses</span><strong>{formatYen(summary.expenses)}</strong></div>
          <div>
            <span>Other income & refunds</span><strong
              >{formatYen(summary.income + summary.refunds)}</strong
            >
          </div>
          <div class="highlight">
            <span>Monthly {summary.savings < 0 ? 'deficit' : 'surplus'}</span><strong
              class:negative={summary.savings < 0}>{formatYen(summary.savings)}</strong
            >
          </div>
        </section>
        <div class="savings-line">
          <span
            >Accumulated savings through {month}
            <b class:negative={accumulated.savings < 0}>{formatYen(accumulated.savings)}</b></span
          ><small
            >{accumulated.unresolved
              ? `${accumulated.unresolved} unresolved amounts excluded · `
              : ''}Salary + income + refunds − expenses</small
          >
        </div>
        <section class="entry card">
          <div class="section-title">
            <h2>{editingId ? 'Edit entry' : 'Quick entry'}</h2>
            <button disabled={busy || !loaded} onclick={() => (scannerOpen = true)}
              >Scan receipt</button
            ><small>Alt N to focus · Ctrl D to duplicate last · Escape to clear</small>
          </div>
          <form
            onsubmit={(e) => {
              e.preventDefault();
              void saveManualEntry();
            }}
          >
            <div class="entry-primary">
              <label
                >Date <span>optional</span><input
                  aria-label="Transaction date"
                  type="date"
                  bind:value={date}
                  bind:this={dateInput}
                /></label
              ><label class="grow"
                >Description<input
                  aria-label="Description"
                  placeholder="What was it for?"
                  bind:value={description}
                  bind:this={descriptionInput}
                  list="descriptions"
                  autocomplete="off"
                /></label
              ><label
                >Amount / calculation<input
                  aria-label="Amount"
                  class="amount-input"
                  placeholder="e.g. 15470/4"
                  bind:value={amount}
                  autocomplete="off"
                /><small>{amountPreview || 'Blank = unresolved'}</small></label
              ><button class="primary add" disabled={busy || !loaded} type="submit"
                >{editingId ? 'Save changes' : 'Add entry'} ↵</button
              >
            </div>
            <div class="entry-details">
              <label
                >Type<select bind:value={type}
                  ><option value="expense">Expense</option><option value="salary">Salary</option
                  ><option value="income">Other income</option><option value="refund"
                    >Refund / reimbursement</option
                  ></select
                ></label
              ><label
                >Report in<input
                  aria-label="Entry reporting month"
                  type="month"
                  bind:value={entryMonth}
                /></label
              ><label
                >Category<input
                  bind:value={category}
                  list="categories"
                  placeholder={suggestion ? `Suggest: ${suggestion}` : 'Uncategorized'}
                /></label
              >{#if suggestion && !category}<button
                  type="button"
                  class="link"
                  onclick={() => (category = suggestion)}>Use {suggestion}</button
                >{/if}<label class="grow"
                >Notes<input bind:value={notes} placeholder="Historical notes or context" /></label
              >{#if editingId}<button type="button" onclick={clearEntry}>Cancel</button>{/if}
            </div>
            <TagSelector tags={ledger.tags} bind:names={entryTags} disabled={busy} />
            <small class="entry-help"
              >Amounts are whole yen, halves away from zero. Negative expense input becomes income.
              Type controls direction; blank dates stay undated.</small
            >
          </form>
          {#if editingId}{@const source = ledger.transactions.find(
              (t) => t.id === editingId,
            )?.source}{#if source}<details>
                <summary>Original import · Sheet1!{source.cell}</summary>
                <pre>{JSON.stringify(source, null, 2)}</pre>
              </details>{/if}{/if}
        </section>
        {#if view === 'month' && suggestions.length}<div class="recurring">
            <span>Recurring suggestions · review before adding</span>{#each suggestions as t}<button
                disabled={busy}
                onclick={() => duplicate(t)}>{t.description} · {formatYen(t.amount || 0)} ＋</button
              >{/each}
          </div>{/if}
        {#if !ledger.transactions.length}<section class="empty card">
            <h2>Start with your existing expenses</h2>
            <p>
              Review the 28 months in your workbook, including undated entries and reconciliation
              differences, before importing.
            </p>
            <button class="primary" disabled={busy} onclick={bundled}
              >Preview Japan expenses.xlsx</button
            ><button disabled={busy} onclick={() => fileInput.click()}>Choose workbook…</button>
          </section>{/if}
      {/if}
      <section class="card ledger">
        <div class="section-title">
          <h2>
            {view === 'history' ? 'History' : 'Transactions'}
            <span class="count">{filtered.length}</span>
          </h2>
          <button onclick={exportCsv} disabled={busy}>Export filtered CSV</button>
        </div>
        <div class="filters">
          <input
            aria-label="Search history"
            class="grow"
            placeholder="Search descriptions, notes, source cells…"
            bind:value={search}
          /><select aria-label="Filter type" bind:value={kind}
            ><option value="">All types</option><option value="expense">Expenses</option><option
              value="salary">Salary</option
            ><option value="income">Other income</option><option value="refund">Refunds</option
            ></select
          ><select aria-label="Filter category" bind:value={categoryFilter}
            ><option value="">All categories</option>{#each categories as c}<option>{c}</option
              >{/each}</select
          ><label class="check"><input type="checkbox" bind:checked={flagged} />Flagged</label>
        </div>
        <TagSelector
          tags={ledger.tags}
          bind:names={filterTags}
          label="Filter tags"
          allowCreate={false}
        /><label class="tag-mode"
          >Tag matching<select bind:value={tagMode}
            ><option value="any">Match ANY selected tag (default)</option><option value="all"
              >Match ALL selected tags</option
            ></select
          ></label
        >
        <div class="bulk-controls">
          <button
            disabled={busy}
            onclick={() =>
              (selectedIds = [
                ...new Set([...selectedIds, ...filtered.slice(0, 500).map((t) => t.id)]),
              ])}>Select visible entries (up to 500)</button
          ><button onclick={() => (selectedIds = [])}>Clear selection</button><small
            >{selectedIds.length} explicitly selected across filters</small
          >{#if selectedIds.length}<TagSelector
              tags={ledger.tags}
              bind:names={bulkNames}
              label="Bulk tags"
              disabled={busy}
            /><button disabled={busy} onclick={() => applyBulk('add')}>Add tags to selected</button
            ><button disabled={busy} onclick={() => applyBulk('remove')}
              >Remove tags from selected</button
            >{/if}
        </div>
        <div class="table-scroll">
          <table>
            <thead
              ><tr
                ><th>Select</th><th>Date / month</th><th>Description</th><th>Type / category</th><th
                  class="right">Amount</th
                ><th class="right">Actions</th></tr
              ></thead
            ><tbody
              >{#each filtered.slice(0, 500) as t (t.id)}<tr
                  ><td
                    ><input
                      type="checkbox"
                      aria-label={`Select ${t.description} ${t.id}`}
                      checked={selectedIds.includes(t.id)}
                      disabled={busy}
                      onchange={() => toggleSelected(t.id)}
                    /></td
                  ><td class="date-cell">{t.date || 'Undated'}<small>{t.month}</small></td><td
                    ><b>{t.description}</b>{#each tagNames(ledger.tags, t.tagIds) as name}<span
                        class="badge">{name}</span
                      >{/each}{#if t.receipt}<small class="source"
                        >Reviewed receipt · {t.receipt.input}</small
                      >{/if}{#if t.notes}<small>{t.notes}</small>{/if}{#if t.flags.length}<small
                        class="flags"
                        title={t.flags.join(' · ')}>⚑ {t.flags.join(' · ')}</small
                      >{/if}{#if t.source}<small class="source">Sheet1!{t.source.cell}</small
                      >{/if}</td
                  ><td>{t.type}<small>{t.category || 'Uncategorized'}</small></td><td
                    class="right numeric"
                    class:income={t.type !== 'expense'}
                    >{t.amount === null ? 'Unresolved' : formatYen(t.amount)}</td
                  ><td class="right actions"
                    ><button
                      aria-label={`Edit ${t.description}`}
                      disabled={busy}
                      onclick={() => edit(t)}>Edit</button
                    ><button
                      title="Duplicate into entry form"
                      disabled={busy}
                      onclick={() => duplicate(t)}>＋</button
                    ><button
                      class="delete"
                      title="Delete entry (Undo available)"
                      aria-label={`Delete ${t.description}`}
                      disabled={busy}
                      onclick={() => remove(t)}>×</button
                    ></td
                  ></tr
                >{/each}</tbody
            >
          </table>
          {#if !filtered.length}<div class="no-results">No entries to show.</div>{/if}
        </div>
        <div class="table-footer">
          <span
            >{filtered.length > 500
              ? 'Showing first 500 matches. Narrow your search.'
              : `${filtered.length} entries`} · {filteredTotals.unresolved} unresolved</span
          ><span>Filtered net <b>{formatYen(filteredTotals.savings)}</b></span>
        </div>
      </section>
    {:else if view === 'import'}
      <section class="card">
        <div class="section-title">
          <div>
            <h2>Review before importing</h2>
            <p>
              Original dates, descriptions, calculations, and notes remain attached to every entry.
              Reporting months stay with the workbook blocks.
            </p>
          </div>
          <div>
            <button disabled={busy} onclick={bundled}>Preview included workbook</button><button
              class="primary"
              disabled={busy}
              onclick={() => fileInput.click()}>Choose .xlsx</button
            >
          </div>
        </div>
      </section>
      {#if pending && importPlan}<section class="card">
          <div class="section-title">
            <div>
              <h2>{pending.report.file}</h2>
              <p>
                {pending.report.counts.amounts} amount entries + {pending.report.counts.missing} unresolved
                + 28 salaries · {pending.report.counts.undated} undated · {pending.report.counts
                  .yearErrors} likely year errors
              </p>
            </div>
            <button class="primary" disabled={busy || !importPlan.fresh.length} onclick={importNow}
              >Import {importPlan.fresh.length} new entries</button
            >
          </div>
          <p>
            {importPlan.skipped.length} existing or previously deleted entries skipped. {importPlan
              .conflicts.length} source changes require review; existing entries are preserved.
          </p>
          {#if importPlan.conflicts.length}<details>
              <summary>Changed source cells — review against existing entries</summary
              >{#each importPlan.conflicts as t}<p>
                  Sheet1!{t.source?.cell}: {t.description} ({t.source?.originalValue}). Existing
                  entry is unchanged. Edit it manually if needed.
                </p>{/each}
            </details>{/if}
          <div class="notice">
            Income/refund labels on negative entries are provisional and editable. No dates are
            corrected automatically. “Pay to…” notes have no accounting effect. ICOCA top-ups count
            as expenses.
          </div>
        </section>
        <section class="card">
          <h2>Monthly reconciliation</h2>
          <p>
            Workbook expense subtotals are net of negative entries, except September 2025. “Raw net”
            converts to your savings convention. “Δ rounding” is rounded net minus exact net. No
            unresolved amount is treated as zero.
          </p>
          <div class="table-scroll">
            <table class="reconciliation">
              <thead
                ><tr
                  ><th>Month / source</th><th class="right">Salary</th><th class="right"
                    >WB subtotal</th
                  ><th class="right">Adjustment</th><th class="right">Raw net</th><th class="right"
                    >Rounded net</th
                  ><th class="right">Δ rounding</th><th class="right">Unexplained</th></tr
                ></thead
              ><tbody
                >{#each pending.report.months as r}<tr
                    ><td
                      >{r.month}<small title={r.subtotalFormula}
                        >{r.subtotalCell} · {r.count} entries{r.unresolved
                          ? ` · ${r.unresolved} unresolved`
                          : ''}</small
                      ></td
                    ><td class="right">{formatNumber(r.salary)}</td><td
                      class="right"
                      title={r.subtotalFormula}>{r.workbookSubtotal}</td
                    ><td class="right">{r.subtotalAdjustment}</td><td class="right"
                      >{r.workbookNet}</td
                    ><td class="right">{formatNumber(r.savings)}</td><td class="right"
                      >{Number(r.roundingDelta)
                        .toFixed(6)
                        .replace(/\.?0+$/, '') || '0'}</td
                    ><td class="right" class:flags={Math.abs(Number(r.unexplained)) > 0.001}
                      >{Math.abs(Number(r.unexplained)) < 0.001 ? '0*' : r.unexplained}</td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          <small
            >* Differences under ¥0.001 are workbook cached-value precision; full differences are
            retained in the report.</small
          >
          <p>
            For the exceptional month, omitted reimbursements are included in the reconciliation
            adjustment shown above. Exact amounts use the source calculations; per-entry rounding
            changes June and August 2026 totals. Unresolved entries leave totals incomplete.
          </p>
          <details>
            <summary>Workbook monthly balance formulas and full reconciliation metadata</summary>
            <pre>{JSON.stringify(pending.report, null, 2)}</pre>
          </details>
        </section>
        <section class="card">
          <div class="section-title">
            <h2>Entry preview <span class="count">{previewRows.length}</span></h2>
            <div class="filters">
              <input
                aria-label="Search import preview"
                placeholder="Search preview…"
                bind:value={previewSearch}
              /><select aria-label="Preview filter" bind:value={previewFilter}
                ><option value="flagged">Flagged entries</option><option value="all"
                  >All entries</option
                ><option value="missing">Missing amounts</option><option value="year"
                  >Likely year errors</option
                ></select
              >
            </div>
          </div>
          <div class="table-scroll">
            <table>
              <thead
                ><tr
                  ><th>Source</th><th>Date / month</th><th>Description</th><th class="right"
                    >Original → rounded</th
                  ><th>Flags</th></tr
                ></thead
              ><tbody
                >{#each previewRows.slice(0, 350) as t}<tr
                    ><td
                      ><details>
                        <summary>{t.source?.cell}</summary>
                        <pre>{JSON.stringify(t.source, null, 2)}</pre>
                      </details></td
                    ><td>{t.date || 'Undated'}<small>Report: {t.month}</small></td><td
                      >{t.description}<small>{t.notes}</small></td
                    ><td class="right" title={t.source?.amount.formula || ''}
                      >{t.source?.originalValue ?? 'Missing'} → {t.amount === null
                        ? 'Unresolved'
                        : formatNumber(t.amount)}</td
                    ><td class="flags">{t.flags.join(' · ')}</td></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          <small
            >Showing up to 350 rows. Search or filter for more. All rows are included in the import.</small
          >
        </section>
      {:else}<section class="empty card">
          <h2>Your workbook stays untouched</h2>
          <p>
            Choose the workbook to inspect all 28 monthly blocks and verify their accounting before
            importing.
          </p>
        </section>{/if}
    {:else}
      <section class="card">
        <div class="section-title">
          <div>
            <h2>Automatic backups</h2>
            <p>
              A dated snapshot is written before every ledger save and restore. Restores also
              support Undo during this session.
            </p>
          </div>
          <button disabled={busy} onclick={makeBackup}>Back up now</button>
        </div>
        <p class="path">{path}/backups</p>
        {#if !native}<p>Backups require the Windows app.</p>{/if}
        <div class="backup-controls">
          <select aria-label="Backup to restore" bind:value={restoreName}
            ><option value="">Choose a backup ({backupNames.length})</option
            >{#each backupNames as name}<option value={name}>{name}</option>{/each}</select
          ><button disabled={!restoreName || busy} onclick={() => (confirmRestore = true)}
            >Restore…</button
          >
        </div>
        {#if confirmRestore}<div class="notice">
            Replace current entries with {restoreName}? Current data will be backed up first.<button
              disabled={busy}
              onclick={restoreBackup}>Restore this backup</button
            ><button onclick={() => (confirmRestore = false)}>Cancel</button>
          </div>{/if}
        <p>
          Keep the entire ExpenseTracker folder together. Copy it elsewhere periodically for
          protection against disk failure. Backups are retained until you remove them yourself.
        </p>
      </section>
      {#if ledger.imports.length}<section class="card">
          <h2>Saved import reports</h2>
          {#each ledger.imports as report}<details>
              <summary
                >{report.file} · {report.generatedAt.slice(0, 10)} · {report.counts.amounts} entries</summary
              >
              <pre>{JSON.stringify(report, null, 2)}</pre>
            </details>{/each}
        </section>{/if}
    {/if}
    <footer role="status">{status || 'Ready. Entries save automatically.'}</footer>
  </main>
</div>
{#if scannerOpen}<ReceiptScanner
    {categories}
    tags={ledger.tags}
    transactions={ledger.transactions}
    onclose={() => (scannerOpen = false)}
    onconfirm={saveReceipt}
  />{/if}
<input type="file" accept=".xlsx" bind:this={fileInput} onchange={pickFile} hidden />
<datalist id="descriptions"
  >{#each descriptions as d}<option value={d}></option>{/each}</datalist
><datalist id="categories"
  >{#each categories as c}<option value={c}></option>{/each}</datalist
>

<style>
  .tag-list {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    margin: 14px 0;
  }
  .tag-create {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .manage {
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--border-soft);
  }
  .manage h3 {
    font-size: 12px;
  }
  .manage > label {
    max-width: 350px;
    margin-bottom: 10px;
  }
  .manage > button {
    margin-right: 7px;
  }
  .tag-mode {
    max-width: 300px;
    margin: 8px 0 12px;
  }
  .bulk-controls {
    background: var(--surface-muted);
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .bulk-controls > button {
    font-size: 10px;
    margin-right: 6px;
  }
  .bulk-controls > small {
    display: inline-block;
  }
  .tag-manager p {
    font-size: 11px;
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    font-family: 'Segoe UI', sans-serif;
    font-size: 13px;
    color: var(--text);
    background: var(--page);
  }
  :global(button),
  :global(input),
  :global(select) {
    font: inherit;
  }
  :global(button) {
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: 6px;
    padding: 7px 11px;
    white-space: nowrap;
  }
  :global(button:hover:not(:disabled)) {
    background: var(--surface-muted);
    border-color: var(--border);
  }
  :global(button:disabled) {
    opacity: 0.45;
    cursor: default;
  }
  :global(button.primary) {
    background: var(--accent-solid);
    color: var(--on-accent);
    border-color: var(--accent-solid);
  }
  :global(button.primary:hover:not(:disabled)) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--on-accent);
  }
  :global(input::placeholder) {
    color: var(--subtle);
    opacity: 1;
  }
  :global(input),
  :global(select) {
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    padding: 8px;
    color: var(--text);
    min-width: 0;
  }
  :global(input:focus),
  :global(select:focus),
  :global(button:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  :global(label) {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 11px;
    color: var(--muted);
  }
  :global(small) {
    display: block;
    font-size: 11px;
    color: var(--subtle);
    line-height: 1.5;
  }
  :global(p) {
    line-height: 1.6;
    color: var(--muted);
  }
  :global(h2) {
    font-size: 14px;
    font-weight: 650;
    margin: 0;
  }
  :global(pre) {
    font:
      11px Consolas,
      monospace;
    white-space: pre-wrap;
    max-height: 400px;
    overflow: auto;
    background: var(--surface-muted);
    padding: 12px;
  }
  :global(details) {
    margin: 8px 0;
  }
  :global(summary) {
    cursor: pointer;
    color: var(--accent);
  }
  :global(.negative) {
    color: var(--negative) !important;
  }
  .shell {
    display: flex;
    min-height: 100vh;
  }
  aside {
    width: 205px;
    background: var(--sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: fixed;
    height: 100vh;
    padding: 26px 16px 14px;
  }
  .brand {
    display: flex;
    gap: 9px;
    align-items: center;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.3px;
    margin-bottom: 35px;
  }
  .brand small {
    font-size: 9px;
    letter-spacing: 1.9px;
    margin-top: 5px;
  }
  .mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: 36px;
    background: var(--accent-solid);
    border-radius: 9px;
    color: var(--on-accent);
    font-size: 22px;
    font-weight: 400;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  nav button {
    border: none;
    background: transparent;
    text-align: left;
    padding: 11px 8px;
    font-size: 12px;
  }
  nav button.active {
    background: var(--selected);
    color: var(--accent);
    font-weight: 650;
  }
  .side-month {
    margin-top: 30px;
  }
  .side-month > label {
    margin-bottom: 8px;
  }
  .side-month > input {
    width: 100%;
    background: var(--surface-raised);
  }
  .month-list {
    overflow: auto;
    max-height: calc(100vh - 470px);
    margin-top: 8px;
  }
  .month-list button {
    display: flex;
    justify-content: space-between;
    width: 100%;
    background: transparent;
    border: 0;
    font-size: 11px;
  }
  .month-list button.chosen {
    background: var(--selected);
  }
  .month-list span {
    color: var(--subtle);
  }
  .side-bottom {
    margin-top: auto;
    color: var(--muted);
    font-size: 11px;
  }
  .side-bottom button {
    display: block;
    margin: 12px 0;
    background: transparent;
  }
  .side-bottom small {
    font-size: 9px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--positive);
    margin-right: 4px;
  }
  main {
    margin-left: 205px;
    padding: 28px 28px 18px;
    width: calc(100% - 205px);
    max-width: 1600px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
  }
  h1 {
    font-weight: 550;
    font-size: 27px;
    letter-spacing: -0.7px;
    margin: 4px 0;
  }
  .eyebrow {
    font-size: 9px;
    letter-spacing: 1.7px;
    color: var(--subtle);
    margin: 0;
  }
  .header-actions {
    display: flex;
    gap: 15px;
    align-items: center;
  }
  .theme-toggle,
  .theme-toggle:hover:not(:disabled) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: 11px;
  }
  .switch-track {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
    border-radius: 20px;
    background: var(--muted);
  }
  .switch-track::after {
    content: '';
    position: absolute;
    left: 3px;
    top: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--on-accent);
    box-shadow: 0 1px 2px #0004;
    transition: transform 120ms;
  }
  .theme-toggle[aria-checked='true'] .switch-track {
    background: var(--accent-solid);
  }
  .theme-toggle[aria-checked='true'] .switch-track::after {
    transform: translateX(16px);
  }
  @media (prefers-reduced-motion: reduce) {
    .switch-track::after {
      transition: none;
    }
  }
  .save-status {
    font-size: 11px;
    color: var(--subtle);
  }
  kbd {
    font:
      10px 'Segoe UI',
      sans-serif;
    color: var(--subtle);
    margin-left: 9px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    overflow: hidden;
  }
  .stats > div {
    padding: 17px 19px;
    border-right: 1px solid var(--border-soft);
  }
  .stats > div:last-child {
    border: 0;
  }
  .stats span {
    font-size: 11px;
    color: var(--muted);
  }
  .stats strong {
    display: block;
    font-size: 24px;
    font-weight: 550;
    letter-spacing: -0.6px;
    margin-top: 10px;
    font-variant-numeric: tabular-nums;
  }
  .stats .highlight {
    background: var(--selected);
  }
  .savings-line {
    display: flex;
    justify-content: space-between;
    margin: 13px 2px 24px;
    font-size: 11px;
    color: var(--muted);
    gap: 10px;
  }
  .savings-line b {
    margin-left: 9px;
    color: var(--accent);
  }
  .card {
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 8px;
    padding: 17px 18px;
    margin-bottom: 16px;
  }
  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 13px;
  }
  .section-title p {
    margin: 7px 0 0;
  }
  .entry-primary {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .entry-primary label:first-child {
    width: 137px;
  }
  .entry-primary label span {
    font-size: 9px;
    display: contents;
  }
  .grow {
    flex: 1;
    min-width: 100px;
  }
  .amount-input {
    width: 165px;
  }
  .entry-primary .add {
    margin-top: 20px;
    height: 34px;
  }
  .entry-details {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: end;
    margin-top: 9px;
  }
  .entry-details label {
    flex: 1;
    min-width: 95px;
  }
  .entry-details input,
  .entry-details select {
    padding: 6px;
    font-size: 11px;
    width: 100%;
  }
  .entry-details .grow {
    flex: 1.5;
  }
  .entry-help {
    margin-top: 10px;
    color: var(--subtle);
    font-size: 10px;
  }
  .link {
    border: none;
    color: var(--accent);
    font-size: 10px;
    background: transparent;
    padding: 5px 0;
  }
  .recurring {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    align-items: center;
    margin: 0 0 16px;
    font-size: 10px;
    color: var(--subtle);
  }
  .recurring button {
    font-size: 10px;
    padding: 4px 7px;
  }
  .filters {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 10px 0 12px;
  }
  .filters input,
  .filters select {
    font-size: 11px;
    padding: 7px;
  }
  .filters > input {
    min-width: 100px;
  }
  .check {
    flex-direction: row;
    align-items: center;
    white-space: nowrap;
  }
  .check input {
    margin: 0;
  }
  .count {
    background: var(--surface-muted);
    border-radius: 4px;
    font-size: 10px;
    font-weight: 400;
    padding: 2px 6px;
    margin-left: 6px;
  }
  .ledger {
    padding-bottom: 0;
  }
  .table-scroll {
    overflow: auto;
    max-height: 560px;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 12px;
  }
  th {
    font-weight: 500;
    text-align: left;
    color: var(--subtle);
    font-size: 10px;
    background: var(--surface-raised);
    padding: 9px 10px;
    border-bottom: 1px solid var(--border-soft);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  td {
    padding: 10px;
    border-bottom: 1px solid var(--border-soft);
    vertical-align: top;
  }
  td small {
    font-size: 10px;
  }
  td b {
    font-weight: 500;
  }
  .right {
    text-align: right;
  }
  .numeric {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 550;
  }
  .income {
    color: var(--positive);
  }
  .date-cell {
    width: 110px;
    white-space: nowrap;
    font-size: 11px;
    color: var(--muted);
  }
  .actions {
    white-space: nowrap;
    width: 100px;
  }
  .actions button {
    padding: 3px 6px;
    font-size: 10px;
    margin-left: 3px;
  }
  .delete {
    color: var(--negative);
  }
  .flags {
    color: var(--warning-text);
    font-size: 10px;
    max-width: 280px;
  }
  .source {
    color: var(--subtle);
    font-size: 9px;
  }
  .badge {
    font-size: 9px;
    background: var(--surface-muted);
    padding: 2px 4px;
    margin-left: 6px;
  }
  .table-footer {
    display: flex;
    justify-content: space-between;
    padding: 12px 0;
    color: var(--subtle);
    font-size: 10px;
  }
  .table-footer b {
    margin-left: 7px;
    color: var(--accent);
  }
  .empty {
    text-align: center;
    padding: 35px 20px;
  }
  .empty h2 {
    font-size: 19px;
    font-weight: 500;
  }
  .empty p {
    max-width: 540px;
    margin: 12px auto 20px;
  }
  .empty button {
    margin: 0 4px;
  }
  .no-results {
    text-align: center;
    color: var(--subtle);
    padding: 30px;
  }
  .notice,
  .error {
    border-radius: 6px;
    padding: 12px 14px;
    margin-bottom: 15px;
    font-size: 12px;
    line-height: 1.6;
    background: var(--warning-bg);
    color: var(--warning-text);
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger-text);
  }
  .notice button,
  .error button {
    margin-left: 12px;
    padding: 3px 7px;
    font-size: 11px;
  }
  .reconciliation {
    font-size: 11px;
  }
  .reconciliation td {
    white-space: nowrap;
    padding: 8px;
  }
  .reconciliation td small {
    font-size: 9px;
  }
  .backup-controls {
    display: flex;
    gap: 10px;
    margin: 20px 0;
  }
  .backup-controls select {
    max-width: 80%;
  }
  .path {
    font:
      11px Consolas,
      monospace;
  }
  .wide {
    width: 100%;
    margin-bottom: 10px;
  }
  footer {
    font-size: 10px;
    color: var(--subtle);
    line-height: 1.5;
    padding: 0 3px 10px;
    overflow-wrap: anywhere;
  }
  @media (max-width: 1050px) {
    aside {
      width: 180px;
      padding: 22px 12px;
    }
    main {
      margin-left: 180px;
      width: calc(100% - 180px);
      padding: 22px 18px;
    }
    .stats strong {
      font-size: 20px;
    }
    .stats > div {
      padding: 15px 12px;
    }
    .amount-input {
      width: 130px;
    }
    .entry-primary {
      gap: 8px;
    }
    .entry-primary label:first-child {
      width: 125px;
    }
    .filters {
      flex-wrap: wrap;
    }
    .savings-line {
      flex-direction: column;
      gap: 3px;
    }
    .entry .section-title small {
      font-size: 9px;
    }
  }
</style>
