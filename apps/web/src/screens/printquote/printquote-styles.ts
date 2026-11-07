/**
 * Scoped Executive Design System & Responsive Styles for PrintQuote.
 * Extracted from PrintQuoteScreen.tsx to keep screen logic lean while preserving
 * Node.js ESM & renderToStaticMarkup compatibility.
 */
export const PRINTQUOTE_STYLES = `
        [data-testid="printquote-screen"] {
          --accent-soft: rgba(20, 184, 166, 0.1);
          --pq-hero-bg: linear-gradient(135deg, rgba(20, 184, 166, 0.14) 0%, rgba(15, 23, 42, 0.88) 100%);
          --pq-hero-border: rgba(20, 184, 166, 0.36);
          --pq-profit-panel-bg: rgba(16, 185, 129, 0.07);
          --pq-profit-panel-border: rgba(16, 185, 129, 0.28);
        }

        :root[data-theme="light"] [data-testid="printquote-screen"],
        [data-theme="light"] [data-testid="printquote-screen"] {
          --accent-soft: rgba(15, 118, 110, 0.08);
          --pq-hero-bg: linear-gradient(135deg, rgba(15, 118, 110, 0.09) 0%, rgba(241, 245, 249, 0.96) 100%);
          --pq-hero-border: rgba(15, 118, 110, 0.28);
          --pq-profit-panel-bg: rgba(4, 120, 87, 0.05);
          --pq-profit-panel-border: rgba(4, 120, 87, 0.24);
        }

        @media (prefers-color-scheme: light) {
          :root[data-theme="system"] [data-testid="printquote-screen"],
          [data-theme="system"] [data-testid="printquote-screen"] {
            --accent-soft: rgba(15, 118, 110, 0.08);
            --pq-hero-bg: linear-gradient(135deg, rgba(15, 118, 110, 0.09) 0%, rgba(241, 245, 249, 0.96) 100%);
            --pq-hero-border: rgba(15, 118, 110, 0.28);
            --pq-profit-panel-bg: rgba(4, 120, 87, 0.05);
            --pq-profit-panel-border: rgba(4, 120, 87, 0.24);
          }
        }

        /* Module Sub-Navigation (unified to /work .app-subnav-bar standard) */
        .pq-module-nav {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          max-width: 100%;
          padding: 0 0 8px 0;
          margin: 0;
          border-radius: 0;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--border-subtle);
          box-shadow: none;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .pq-module-nav::-webkit-scrollbar {
          display: none;
        }
        .pq-module-nav-item {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--muted-color);
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .pq-module-nav-item:hover {
          color: var(--text-color);
          background: rgba(148, 163, 184, 0.08);
        }
        .pq-module-nav-item[data-active="true"] {
          background: var(--primary-subtle);
          color: var(--accent-text);
          border-color: transparent;
          font-weight: 600;
          box-shadow: none;
        }
        .pq-nav-count-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 6px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
          line-height: 1;
          font-variant-numeric: tabular-nums;
          background: var(--surface-subtle);
          color: var(--muted-color);
          border: 1px solid var(--border-subtle);
        }
        .pq-nav-count-pill[data-active="true"] {
          background: rgba(20, 184, 166, 0.18);
          color: var(--accent-text);
          border-color: transparent;
        }

        /* Catalog Secondary Filter Chips (harmonized with /work focus chips) */
        .pq-catalog-subnav {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: nowrap;
          overflow-x: auto;
          scrollbar-width: none;
          padding-bottom: 2px;
        }
        .pq-catalog-subnav::-webkit-scrollbar {
          display: none;
        }
        .pq-catalog-subnav-item {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 34px;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border-subtle);
          background: var(--surface-subtle);
          color: var(--muted-color);
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          flex-shrink: 0;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .pq-catalog-subnav-item:hover {
          color: var(--text-color);
          border-color: var(--border-hover);
        }
        .pq-catalog-subnav-item[data-active="true"] {
          background: var(--primary-subtle);
          color: var(--accent-text);
          border-color: #14B8A6;
          font-weight: 600;
        }

        /* Clean Page Head (unified to /work PageHeader standard) */
        .pq-page-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 4px;
        }
        .pq-page-head > div:first-child {
          min-width: 0;
          flex: 1 1 180px;
        }
        .pq-page-title {
          margin: 0;
          font-family: var(--font-sans);
          font-size: var(--heading-page-size, 22px);
          font-weight: var(--heading-page-weight, 700);
          letter-spacing: var(--heading-tracking, -0.015em);
          line-height: var(--heading-page-lh, 1.3);
          color: var(--text-color);
          overflow-wrap: break-word;
        }
        .pq-page-subtitle {
          margin: 4px 0 0;
          font-family: var(--font-sans);
          font-size: var(--subtitle-size, 13.5px);
          line-height: var(--subtitle-lh, 1.45);
          color: var(--muted-color);
        }

        /* Unified Button Hierarchy */
        .pq-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          min-height: 40px;
          padding: 8px 14px;
          border-radius: 10px;
          border: 1px solid transparent;
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.2;
          white-space: nowrap;
          cursor: pointer;
          text-decoration: none;
          transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.1s ease;
        }
        .pq-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .pq-btn:focus-visible,
        .pq-module-nav-item:focus-visible,
        .pq-catalog-subnav-item:focus-visible,
        .pq-filter-pill:focus-visible,
        .pq-segmented-btn:focus-visible,
        .pq-code-link:focus-visible,
        .pq-picker-row:focus-visible {
          outline: 2px solid var(--focus-ring);
          outline-offset: 2px;
        }
        .pq-btn-sm {
          min-height: 36px;
          padding: 6px 11px;
          border-radius: 8px;
          font-size: 12.5px;
        }
        .pq-btn-lg {
          min-height: 44px;
          padding: 10px 18px;
          border-radius: 11px;
          font-size: 13.5px;
          font-weight: 700;
        }
        .pq-btn-cta {
          min-height: 44px;
          padding: 0 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
        }
        .pq-btn-primary {
          background: var(--primary-color);
          color: var(--inverse-text);
          border-color: var(--primary-color);
          font-weight: 700;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
        }
        .pq-btn-primary:hover:not(:disabled) {
          background: var(--primary-hover);
          border-color: var(--primary-hover);
        }
        .pq-btn-secondary {
          background: var(--surface-color);
          color: var(--text-color);
          border-color: var(--border-color);
        }
        .pq-btn-secondary:hover:not(:disabled) {
          background: var(--surface-hover);
          border-color: var(--border-hover);
        }
        .pq-btn-accent {
          background: var(--accent-soft);
          color: var(--accent-text);
          border-color: var(--accent-text);
          font-weight: 700;
        }
        .pq-btn-accent:hover:not(:disabled) {
          background: var(--primary-subtle);
        }
        .pq-btn-success {
          background: var(--success-color);
          color: var(--inverse-text);
          border-color: var(--success-color);
          font-weight: 700;
        }
        .pq-btn-success:hover:not(:disabled) {
          background: var(--success-hover);
          border-color: var(--success-hover);
        }
        .pq-btn-ghost {
          background: transparent;
          color: var(--muted-color);
          border-color: var(--border-color);
        }
        .pq-btn-ghost:hover:not(:disabled) {
          background: var(--surface-subtle);
          color: var(--text-color);
        }
        .pq-btn-danger-ghost {
          background: transparent;
          color: var(--danger-text);
          border-color: rgba(239, 68, 68, 0.35);
        }
        .pq-btn-danger-ghost:hover:not(:disabled) {
          background: var(--danger-subtle);
        }

        /* Unified Search & Filter Toolbar */
        .pq-toolbar-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 12px 14px;
          border-radius: 13px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
        }
        .pq-search-wrap {
          position: relative;
          flex: 1 1 260px;
          min-width: 0;
        }
        .pq-search-icon {
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--muted-color);
          pointer-events: none;
        }
        .pq-filter-pills {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .pq-filter-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid var(--border-color);
          background: var(--surface-subtle);
          color: var(--muted-color);
          font-size: 12.5px;
          font-weight: 600;
          white-space: nowrap;
          cursor: pointer;
          transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        }
        .pq-filter-pill:hover {
          color: var(--text-color);
          border-color: var(--border-hover);
        }
        .pq-filter-pill[data-active="true"] {
          background: var(--accent-soft);
          color: var(--accent-text);
          border-color: var(--accent-text);
          font-weight: 700;
        }
        .pq-filter-pill-count {
          font-size: 12px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          opacity: 0.9;
        }

        /* Executive Quote & Order Cards */
        .pq-quote-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px 20px;
          border-radius: 14px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .pq-quote-card:hover {
          border-color: var(--border-hover);
        }
        .pq-quote-card-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 14px;
        }
        .pq-code-link {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          border-radius: 7px;
          border: 1px solid var(--accent-text);
          background: var(--accent-soft);
          color: var(--accent-text);
          font-size: 12.5px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
        }
        .pq-code-pill,
        .pq-version-pill {
          display: inline-flex;
          align-items: center;
          padding: 3px 8px;
          border-radius: 7px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pq-quote-metrics {
          display: flex;
          align-items: stretch;
          gap: 10px;
          flex-wrap: wrap;
        }
        .pq-metric-cell {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 8px 12px;
          border-radius: 10px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          min-width: 112px;
        }
        .pq-metric-cell-total {
          background: var(--pq-hero-bg);
          border-color: var(--pq-hero-border);
          min-width: 140px;
        }
        .pq-metric-label {
          font-size: 12px;
          color: var(--muted-color);
          font-weight: 600;
          margin-bottom: 2px;
        }
        .pq-metric-val {
          font-size: 14px;
          font-weight: 700;
          color: var(--text-color);
        }
        .pq-metric-total-val {
          font-size: 17px;
          font-weight: 800;
          color: var(--text-color);
        }
        .pq-quote-card-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding-top: 12px;
          border-top: 1px solid var(--border-subtle);
        }
        .pq-action-group-left,
        .pq-action-group-right {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }
        .pq-converted-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 6px 12px;
          border-radius: 999px;
          background: var(--success-subtle);
          border: 1px solid var(--success-text);
          color: var(--success-text);
          font-size: 12.5px;
          font-weight: 700;
        }

        /* Empty States */
        .pq-empty-icon-ring {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-soft);
          color: var(--accent-text);
          border: 1px solid var(--pq-hero-border);
        }

        /* Editor Workspace (Create / Edit Quote) */
        .pq-editor-topbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          padding-bottom: 4px;
        }
        .pq-editor-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr);
          gap: 18px;
          align-items: start;
        }
        .pq-editor-summary-col {
          position: sticky;
          top: 14px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-width: 0;
        }
        .pq-step-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-bottom: 14px;
        }
        .pq-step-title-group {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .pq-step-badge {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--accent-soft);
          border: 1px solid var(--accent-text);
          color: var(--accent-text);
          font-size: 12.5px;
          font-weight: 800;
          flex-shrink: 0;
        }
        .pq-step-heading {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--text-color);
        }
        .pq-customer-grid,
        .pq-two-col-fields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        /* Product Line Card */
        .pq-product-card {
          padding: 16px;
          border-radius: 13px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          transition: border-color 0.15s ease;
        }
        .pq-product-card:focus-within {
          border-color: var(--accent-text);
        }
        .pq-product-card-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 12px;
        }
        .pq-catalog-quickbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          margin-bottom: 12px;
        }
        [data-testid="printquote-screen"] input:not([type="checkbox"]):not([type="radio"]):not([aria-invalid="true"]):focus-visible,
        [data-testid="printquote-screen"] select:not([aria-invalid="true"]):focus-visible,
        [data-testid="printquote-screen"] textarea:not([aria-invalid="true"]):focus-visible {
          border-color: var(--accent-text) !important;
          outline: 2px solid var(--focus-ring) !important;
          outline-offset: 0px !important;
        }
        .pq-field-label-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          min-height: 20px;
          margin-bottom: 6px;
          white-space: nowrap;
        }
        .pq-field-label-row label {
          margin-bottom: 0 !important;
          white-space: nowrap;
        }
        .pq-inline-label-action {
          background: transparent;
          border: none;
          padding: 0 2px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          color: var(--accent-text);
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .pq-product-info-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(176px, 1.2fr) minmax(196px, 1.25fr);
          gap: 10px;
          align-items: end;
          margin-bottom: 12px;
        }
        .pq-qty-unit-pair {
          display: grid;
          grid-template-columns: minmax(108px, 1.45fr) minmax(74px, 0.85fr);
          gap: 8px;
          align-items: end;
        }
        .pq-pricing-pair-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .pq-internal-subpanel {
          padding: 12px;
          border-radius: 11px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
        }
        .pq-internal-subpanel-profit {
          background: var(--pq-profit-panel-bg);
          border-color: var(--pq-profit-panel-border);
        }
        .pq-internal-subpanel-title {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 7px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--text-color);
          margin-bottom: 10px;
        }
        .pq-subpanel-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .pq-numeric-input {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .pq-checkbox-card {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          font-size: 13px;
          cursor: pointer;
        }
        .pq-advanced-box {
          padding: 14px;
          border-radius: 11px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        /* Executive Summary Right Column */
        .pq-summary-hero,
        .pq-hero-total-box {
          padding: 16px 18px;
          border-radius: 13px;
          background: var(--pq-hero-bg);
          border: 1px solid var(--pq-hero-border);
        }
        .pq-summary-hero-label,
        .pq-hero-total-label {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--accent-text);
          margin-bottom: 4px;
        }
        .pq-summary-hero-value,
        .pq-hero-total-amount {
          font-size: 26px;
          font-weight: 800;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: var(--text-color);
        }
        .pq-summary-hero-words {
          margin-top: 6px;
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--muted-color);
        }
        .pq-internal-kpi-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .pq-kpi-mini-card {
          padding: 10px;
          border-radius: 10px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          min-width: 0;
        }
        .pq-kpi-mini-label {
          font-size: 12px;
          color: var(--muted-color);
          margin-bottom: 3px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pq-kpi-mini-val {
          display: block;
          font-size: 13.5px;
          font-weight: 800;
          color: var(--text-color);
          overflow-wrap: anywhere;
        }
        .pq-summary-preview-box {
          padding: 12px;
          border-radius: 12px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
        }
        .pq-segmented-switch {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 3px;
          border-radius: 9px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
        }
        .pq-segmented-btn {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 32px;
          padding: 4px 10px;
          border-radius: 7px;
          border: none;
          background: transparent;
          color: var(--muted-color);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .pq-segmented-btn[data-active="true"] {
          background: var(--primary-color);
          color: var(--inverse-text);
          font-weight: 700;
        }
        .pq-safe-pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--success-subtle);
          color: var(--success-text);
          font-size: 12px;
          font-weight: 700;
        }
        .pq-empty-summary-box {
          padding: 20px 16px;
          border-radius: 12px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
          text-align: center;
          color: var(--muted-color);
          font-size: 13px;
          line-height: 1.5;
        }
        .pq-action-card {
          padding: 14px;
          border-radius: 14px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        /* Catalog Picker Row */
        .pq-picker-row {
          width: 100%;
          text-align: left;
          padding: 12px 14px;
          border-radius: 11px;
          border: 1px solid var(--border-color);
          background: var(--surface-subtle);
          color: var(--text-color);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          transition: border-color 0.15s ease, background-color 0.15s ease;
        }
        .pq-picker-row:hover {
          border-color: var(--accent-text);
          background: var(--accent-soft);
        }

        /* Quote Detail View & Realistic A4 Paper Stage */
        .pq-detail-split-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.95fr);
          gap: 18px;
          align-items: start;
        }
        .pq-a4-stage {
          padding: 18px;
          border-radius: 12px;
          background: #1e293b;
          border: 1px solid var(--border-color);
          display: flex;
          justify-content: center;
        }
        :root[data-theme="light"] .pq-a4-stage,
        [data-theme="light"] .pq-a4-stage {
          background: #e2e8f0;
        }
        .pq-a4-iframe {
          width: 100%;
          max-width: 794px;
          height: 680px;
          border: none;
          border-radius: 6px;
          background: #FFFFFF;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.28);
        }
        .pq-version-drawer,
        .pq-version-card {
          padding: 12px 14px;
          border-radius: 11px;
          background: var(--surface-subtle);
          border: 1px solid var(--border-color);
        }
        .pq-version-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 0;
          border-bottom: 1px solid var(--border-subtle);
          font-size: 12.5px;
        }
        .pq-version-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }

        /* Analytics Stat Cards & Tables */
        .pq-stat-card {
          padding: 16px 18px;
          border-radius: 14px;
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          box-shadow: var(--shadow-sm);
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .pq-stat-label {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--muted-color);
        }
        .pq-stat-value {
          font-size: 22px;
          font-weight: 800;
          line-height: 1.2;
          letter-spacing: -0.02em;
          color: var(--text-color);
          font-variant-numeric: tabular-nums;
        }
        .pq-stat-sub {
          font-size: 12px;
          color: var(--muted-color);
        }
        .pq-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .pq-table th {
          text-align: left;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 700;
          color: var(--muted-color);
          border-bottom: 1px solid var(--border-color);
          white-space: nowrap;
        }
        .pq-table td {
          padding: 10px;
          border-bottom: 1px solid var(--border-subtle);
          vertical-align: top;
        }
        .pq-table tbody tr:last-child td {
          border-bottom: none;
        }
        .pq-table-compact th,
        .pq-table-compact td {
          padding: 7px 8px;
          font-size: 12.5px;
        }

        /* Directory List Table (Customers & Vendors) */
        .pq-directory-card {
          background: var(--surface-color);
          border: 1px solid var(--border-color);
          border-radius: 14px;
          box-shadow: var(--shadow-sm);
          overflow-x: auto;
        }
        .pq-directory-table th {
          background: var(--surface-subtle);
          padding: 11px 16px;
          font-size: 12px;
          font-weight: 700;
          color: var(--text-secondary);
          border-bottom: 1px solid var(--border-color);
          white-space: nowrap;
        }
        .pq-directory-table td {
          padding: 12px 16px;
          vertical-align: middle;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-color);
          font-size: 13.5px;
        }
        .pq-directory-table tbody tr {
          transition: background-color 0.14s ease;
        }
        .pq-directory-table tbody tr:hover {
          background: var(--surface-subtle);
        }
        .pq-directory-cell-primary {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .pq-directory-cell-primary .pq-code-pill {
          min-width: 56px;
          justify-content: center;
          flex-shrink: 0;
        }
        .pq-directory-name {
          font-weight: 700;
          font-size: 14px;
          color: var(--text-color);
          overflow-wrap: anywhere;
        }
        .pq-directory-muted {
          color: var(--muted-color);
          font-size: 13px;
        }

        /* Tablet & Mobile Responsive Adaptations */
        @media (max-width: 1180px) {
          .pq-product-info-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pq-product-info-grid > div:first-child {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 1080px) {
          .pq-editor-grid,
          .pq-detail-split-layout {
            grid-template-columns: minmax(0, 1fr);
          }
          .pq-editor-summary-col {
            position: static;
          }
        }

        @media (max-width: 768px) {
          [data-testid="printquote-screen"] input:not([type="checkbox"]):not([type="radio"]),
          [data-testid="printquote-screen"] select,
          [data-testid="printquote-screen"] textarea {
            font-size: 16px !important;
            min-width: 0;
          }
          .pq-page-head {
            gap: 8px;
            margin-bottom: 0;
          }
          .pq-page-title {
            font-size: 17.5px;
          }
          .pq-page-subtitle {
            display: none !important;
          }
          .pq-module-nav {
            width: 100%;
            max-width: 100%;
            display: flex;
            flex-wrap: wrap;
            overflow-x: hidden;
            gap: 4px;
            margin-bottom: 12px;
            padding: 0 0 8px 0;
          }
          .pq-module-nav .pq-nav-count-pill {
            display: none;
          }
          .pq-module-nav-item {
            padding: 5px 9px;
            gap: 5px;
            font-size: 12px;
            border-radius: 8px;
            max-width: 100%;
          }
          .pq-customer-grid,
          .pq-two-col-fields,
          .pq-product-info-grid,
          .pq-pricing-pair-grid {
            grid-template-columns: minmax(0, 1fr);
          }
          .pq-internal-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .pq-internal-kpi-grid > div:last-child {
            grid-column: 1 / -1;
          }
          .pq-quote-card {
            padding: 14px;
          }
          .pq-quote-metrics {
            width: 100%;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }
          .pq-metric-cell,
          .pq-metric-cell-total {
            min-width: 0;
          }
          .pq-hero-total-box {
            width: 100%;
          }
          .pq-a4-stage {
            padding: 8px;
          }
          .pq-a4-iframe {
            height: 480px;
          }
          table.pq-table.rt-cards tfoot,
          table.pq-table.rt-cards tfoot tr {
            display: block;
            width: 100%;
          }
          table.pq-table.rt-cards tfoot td {
            display: inline-block;
            padding: 8px 6px !important;
          }
          .pq-directory-card {
            background: transparent;
            border: 0;
            border-radius: 0;
            box-shadow: none;
            overflow: visible;
          }
          .pq-directory-table tbody tr:hover {
            background: var(--surface-color);
          }
          .pq-directory-table .pq-btn-sm {
            min-height: 40px;
            padding: 8px 14px;
          }
        }

        @media (max-width: 400px) {
          .pq-module-nav-item {
            flex: 0 0 auto;
            padding: 5px 8px;
            font-size: 12px;
          }
          .pq-module-nav-item svg {
            display: none;
          }
          .pq-qty-unit-pair {
            grid-template-columns: minmax(0, 1fr);
          }
          .pq-filter-pills {
            width: 100%;
            overflow-x: auto;
            flex-wrap: nowrap;
            scrollbar-width: none;
          }
          .pq-filter-pills::-webkit-scrollbar {
            display: none;
          }
          .pq-action-group-left,
          .pq-action-group-right {
            width: 100%;
          }
          .pq-action-group-right .pq-btn {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pq-btn,
          .pq-module-nav-item,
          .pq-catalog-subnav-item,
          .pq-filter-pill,
          .pq-quote-card,
          .pq-product-card,
          .pq-picker-row {
            transition: none !important;
          }
        }
      `;
