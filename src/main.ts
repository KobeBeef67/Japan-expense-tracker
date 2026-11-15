import { mount } from 'svelte';
import App from './App.svelte';
import './theme.css';
import { applyTheme } from './lib/theme';
applyTheme('light');
mount(App, { target: document.getElementById('app')! });
