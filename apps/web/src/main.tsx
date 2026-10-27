import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { installClientErrorReporter } from './client-error-reporter.js';
import '@management-lite/ui/tokens.css';

installClientErrorReporter();

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
