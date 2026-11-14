import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardService } from '../../dist/apps/api/src/dashboard/service.js';
import { DashboardScreen } from '../../dist/apps/web/src/screens/DashboardScreen.js';
import { SYSTEM_VERSION } from '../../dist/packages/contracts/src/version.js';
import { RELEASE_NOTES_CATALOG } from '../../dist/packages/contracts/src/release-notes-catalog.js';

const ROOT = process.cwd();

describe('Phase 4 (v1.0.0) — Proactive Dashboard Action Center & v1.0.0 Milestone', () => {
  it('1. DashboardService.getSummary populates print_quotes & accounts_health for Owner, hides for Staff, and degrades gracefully on optional table errors', async () => {
    const baseSummaryRow = {
      current_shift_id: null,
      current_shift_run_state: null,
      current_shift_clock_in_at: null,
      recent_shifts_count: 5,
      completed_shifts_count: 5,
      total_worked_seconds: 144000,
      today_report_id: null,
      today_report_date: null,
      today_report_status: null,
      today_report_entries_count: null,
      today_report_total_reported_count: null,
      total_reports_count: 10,
      emp_total_count: 6,
      emp_active_count: 5,
      emp_invited_count: 1,
      pay_period_id: 'pp-1',
      pay_period_status: 'draft',
      pay_employee_count: 4,
    };

    const ownerPool = {
      async query(sql) {
        const s = String(sql);
        if (s.includes('FROM print_orders')) {
          return {
            rows: [
              {
                active_orders_count: 3,
                receivable_orders_count: 2,
                total_receivable_vnd: '4500000',
              },
            ],
          };
        }
        if (s.includes('FROM managed_accounts')) {
          return {
            rows: [{ attention_count: 4 }],
          };
        }
        return { rows: [baseSummaryRow] };
      },
    };

    const ownerSvc = new DashboardService(ownerPool);
    const ownerCtx = {
      workspace: { id: 'ws-1', role: 'owner' },
      user: { id: 'u-owner' },
    };
    const ownerSummary = await ownerSvc.getSummary(ownerCtx, {
      date: '2026-11-14',
      month: '2026-11',
    });
    assert.deepEqual(ownerSummary.print_quotes, {
      active_orders_count: 3,
      receivable_orders_count: 2,
      total_receivable_vnd: 4500000,
    });
    assert.deepEqual(ownerSummary.accounts_health, {
      attention_count: 4,
    });

    const staffCtx = {
      workspace: { id: 'ws-1', role: 'staff' },
      user: { id: 'u-staff' },
    };
    const staffSummary = await ownerSvc.getSummary(staffCtx, {
      date: '2026-11-14',
      month: '2026-11',
    });
    assert.equal(staffSummary.print_quotes, null);
    assert.equal(staffSummary.accounts_health, null);

    const degradedPool = {
      async query(sql) {
        const s = String(sql);
        if (
          s.includes('FROM print_orders') ||
          s.includes('FROM managed_accounts')
        ) {
          throw new Error('relation does not exist');
        }
        return { rows: [baseSummaryRow] };
      },
    };
    const degradedSvc = new DashboardService(degradedPool);
    const degradedSummary = await degradedSvc.getSummary(ownerCtx, {
      date: '2026-11-14',
      month: '2026-11',
    });
    assert.equal(degradedSummary.print_quotes, null);
    assert.equal(degradedSummary.accounts_health, null);
    assert.equal(degradedSummary.employees?.active_count, 5);
  });

  it('2. DashboardScreen renders PrintQuote & Accounts Health Action Center alerts for Owner only when counts > 0', () => {
    const ownerAlertHtml = renderToStaticMarkup(
      React.createElement(DashboardScreen, {
        role: 'owner',
        workspaceName: 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
        onNavigate: () => {},
        initialPrintQuoteAlert: {
          active_orders_count: 2,
          receivable_orders_count: 1,
          total_receivable_vnd: 1850000,
        },
        initialAccountsHealthCount: 3,
      }),
    );
    assert.ok(
      ownerAlertHtml.includes('data-testid="action-center-printquote-alerts"'),
      'Owner should see PrintQuote alert when debt/orders > 0',
    );
    assert.ok(
      ownerAlertHtml.includes('1.850.000 ₫'),
      'Owner PrintQuote alert should display formatted receivable VND',
    );
    assert.ok(
      ownerAlertHtml.includes('data-testid="action-center-accounts-health"'),
      'Owner should see Accounts Health alert when count > 0',
    );
    assert.ok(
      ownerAlertHtml.includes('3 tài khoản cần kiểm tra trạng thái'),
      'Owner Accounts Health alert should display count',
    );

    const ownerZeroHtml = renderToStaticMarkup(
      React.createElement(DashboardScreen, {
        role: 'owner',
        workspaceName: 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
        onNavigate: () => {},
        initialPrintQuoteAlert: {
          active_orders_count: 0,
          receivable_orders_count: 0,
          total_receivable_vnd: 0,
        },
        initialAccountsHealthCount: 0,
      }),
    );
    assert.equal(
      ownerZeroHtml.includes('data-testid="action-center-printquote-alerts"'),
      false,
      'Zero PrintQuote counts must not clutter Action Center',
    );
    assert.equal(
      ownerZeroHtml.includes('data-testid="action-center-accounts-health"'),
      false,
      'Zero Accounts Health count must not clutter Action Center',
    );

    const staffHtml = renderToStaticMarkup(
      React.createElement(DashboardScreen, {
        role: 'staff',
        workspaceName: 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
        onNavigate: () => {},
        initialPrintQuoteAlert: {
          active_orders_count: 5,
          receivable_orders_count: 5,
          total_receivable_vnd: 9000000,
        },
        initialAccountsHealthCount: 5,
      }),
    );
    assert.equal(
      staffHtml.includes('data-testid="action-center-printquote-alerts"'),
      false,
      'Staff must never see Owner PrintQuote alert',
    );
    assert.equal(
      staffHtml.includes('data-testid="action-center-accounts-health"'),
      false,
      'Staff must never see Owner Accounts Health alert',
    );
  });

  it('3. Version milestone v1.0.0 is synchronized across package.json, version.ts, and RELEASE_NOTES_CATALOG', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
    );
    assert.equal(pkg.version, '1.0.0');
    assert.equal(SYSTEM_VERSION, '1.0.0');
    assert.equal(RELEASE_NOTES_CATALOG[0]?.version, '1.0.0');
    assert.equal(RELEASE_NOTES_CATALOG[0]?.commit, 'latest');
  });
});
